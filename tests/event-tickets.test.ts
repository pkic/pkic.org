import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { hmacSha256Hex } from "../functions/_lib/utils/crypto";
import {
  eventTicketCodeListQuerySchema,
  registrationTicketCheckoutResponseSchema,
  registrationTicketResponseSchema,
} from "../assets/shared/schemas/event-tickets";
import { seedEventAndAdmin } from "./helpers/context";
import { createScheduledRegistration } from "./helpers/scheduled-registration";
import { findOrCreateUser } from "../functions/_lib/services/users";
import {
  createEventTicketCode,
  readEventTicketsConfiguration,
  replaceEventTicketPrices,
  saveEventTicketType,
  updateEventTicketCode,
  updateEventTicketSettings,
} from "../functions/_lib/services/event-tickets/configuration";
import { quoteEventTicket, readEventTicketOffer } from "../functions/_lib/services/event-tickets/offer";
import {
  isTicketCodeExhausted,
  planRegistrationTicket,
  assertRegistrationTicketRestorable,
  prepareCancelRegistrationTicket,
  prepareRestoreRegistrationTicket,
  readRegistrationTicket,
} from "../functions/_lib/services/event-tickets/registration-ticket";
import {
  handleEventTicketStripeEvent,
  openTicketCheckout,
  prepareHoldConfirmationForPayment,
  sendTicketPaymentReminders,
} from "../functions/_lib/services/event-tickets/payment";
import {
  closeUnpayableTicketCheckouts,
  processTicketRefunds,
  requestTicketRefund,
} from "../functions/_lib/services/event-tickets/refunds";
import { listEventTicketCodes } from "../functions/_lib/services/event-tickets/code-list";
import { reviewDisputedTicket } from "../functions/_lib/services/event-tickets/dispute";
import { issueSponsorPassCodes, saveSponsorPasses } from "../functions/_lib/services/event-tickets/sponsor-passes";
import { badgeAttendeeEligibilitySql } from "../functions/_lib/services/event-participation/badge-attendees";
import type { Env, UserBackedAuthAdmin } from "../functions/_lib/types";

const DAY = "2026-12-01";
const inPerson = [{ dayDate: DAY, attendanceType: "in_person" }];
const paymentEnv = { ...env, STRIPE_SECRET_KEY: "sk_test_synthetic" } as Env;

/** A classifier that answers every organization with fixed probabilities. */
function classifier(probabilities: Record<string, number>): Pick<Env, "AI"> {
  return { AI: { run: async () => ({ answers: { ticket: { probabilities } } }) } };
}

async function seedTickets() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const event = { id: eventId, timezone: "Europe/Amsterdam" };
  let revision = 0;
  for (const input of [
    {
      key: "pqcc_attendee",
      name: "Attendee",
      classifierDescription: "Uses or runs cryptography for itself.",
      isDefault: true,
    },
    {
      key: "pqcc_vendor",
      name: "Vendor",
      classifierDescription: "Sells cryptography products or services.",
      isDefault: false,
    },
  ])
    revision = (
      await saveEventTicketType(env.DB, admin, event, null, {
        expectedRevision: revision,
        descriptionMarkdown: "",
        classifierThresholdPercent: 85,
        freeRequiresWorkEmail: input.isDefault,
        active: true,
        ...input,
      })
    ).revision;
  const configuration = await readEventTicketsConfiguration(env.DB, event);
  const [attendee, vendor] = configuration.types;
  await replaceEventTicketPrices(env.DB, admin, event, {
    expectedRevision: revision,
    periods: [
      { id: "open", startsOn: null },
      { id: "later", startsOn: "2099-01-01" },
    ],
    prices: [
      {
        id: "a",
        ticketTypeId: attendee.id,
        attendanceValue: "in_person",
        dayDate: null,
        charged: "once",
        amounts: { later: 19500 },
      },
      {
        id: "v",
        ticketTypeId: vendor.id,
        attendanceValue: "in_person",
        dayDate: null,
        charged: "once",
        amounts: { open: 39500, later: 49500 },
      },
    ],
  });
  return { event, admin, attendee, vendor };
}

async function register(event: { id: string; timezone: string }, email: string, classifierEnv: Pick<Env, "AI"> = {}) {
  const user = await findOrCreateUser(env.DB, { email, firstName: "Synthetic", lastName: "Person" });
  const { registration } = await createScheduledRegistration(env.DB, {
    event: { id: event.id },
    userId: user.id,
    sourceType: "direct",
    mailboxVerified: true,
  });
  const ticket = await planRegistrationTicket(env.DB, classifierEnv, {
    event,
    registrationId: registration.id,
    userId: user.id,
    email,
    identityId: null,
    organizationName: "Example Organization",
    dayAttendance: inPerson,
  });
  if (ticket) await env.DB.batch(ticket.statements);
  return { user, registration, ticket };
}

async function paidEvent(ticketId: string, sessionId: string, amount: number, id = `evt_${crypto.randomUUID()}`) {
  return handleEventTicketStripeEvent(env.DB, {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_intent: "pi_synthetic",
        amount_total: amount,
        currency: "usd",
        payment_status: "paid",
        metadata: { pkic_payment_type: "event", registrationTicketId: ticketId },
      },
    },
  });
}

const stripe = (async () =>
  new Response(JSON.stringify({ id: "cs_test_ticket", url: "https://checkout.stripe.com/c/pay/cs_test_ticket" }), {
    status: 200,
  })) as typeof fetch;

beforeEach(resetDb);

describe("event tickets", () => {
  it("leaves registration unchanged for an event without tickets", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { ticket } = await register({ id: eventId, timezone: "Europe/Amsterdam" }, "person@example.test");
    expect(ticket).toBeNull();
  });

  it("gives the default ticket free to a work address and prices it for a personal address", async () => {
    const { event } = await seedTickets();
    const work = await register(event, "person@example-organization.test");
    expect(work.ticket).toMatchObject({ ticketName: "Attendee", amount: 0, status: "free" });
    const personal = await register(event, "person@gmail.com");
    expect(personal.ticket).toMatchObject({ ticketName: "Attendee", amount: 19500, status: "pending_payment" });
    // The offer states the rule before the person registers: what the ticket costs a personal address.
    const offered = await readEventTicketOffer(env.DB, {}, event, {
      userId: personal.user.id,
      email: personal.user.email,
    });
    expect(offered.personalEmail).toBe(true);
    expect(offered.tickets.map((ticket) => [ticket.key, ticket.personalEmailAmount])).toEqual([
      ["pqcc_attendee", 19500],
      ["pqcc_vendor", null],
    ]);
    // Each price says it too, so the ticket and the day rows show what this address is charged.
    expect(offered.tickets[0].prices.filter((price) => price.personalEmailAmount !== null)).toMatchObject([
      { amount: 0, personalEmailAmount: 19500 },
    ]);
  });

  it("prices the ticket for the identity registered as: a work address on a personal account is free", async () => {
    const { event } = await seedTickets();
    const user = await findOrCreateUser(env.DB, { email: "owner@gmail.com", firstName: "A", lastName: "B" });
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES ('org-1', 'Example Works', 'example works', ?, ?)",
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
         VALUES ('mail-1', ?, 'owner@example-works.test', 'owner@example-works.test', ?, 'registration_confirmation', ?)`,
      ).bind(user.id, now, now),
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, email_id, job_title, source, invited_at, started_at, created_at, updated_at)
         VALUES ('identity-1', ?, 'org-1', 'mail-1', 'Engineer', 'verified_domain', ?, ?, ?, ?)`,
      ).bind(user.id, now, now, now, now),
    ]);
    const who = { userId: user.id, email: user.email };
    const quote = (identityId?: string) =>
      quoteEventTicket(env.DB, {}, event, who, { dayAttendance: inPerson, identityId, save: false });
    expect(await quote("identity-1")).toMatchObject({ total: 0, personalEmailPrice: false });
    expect((await readEventTicketOffer(env.DB, {}, event, who, "identity-1")).personalEmail).toBe(false);
    // An identity that does not exist, and one that belongs to somebody else, are not theirs to register as:
    // the account's own address prices the ticket.
    expect(await quote("00000000-0000-4000-8000-00000000dead")).toMatchObject({
      total: 19500,
      personalEmailPrice: true,
    });
    const other = await findOrCreateUser(env.DB, { email: "other@gmail.com", firstName: "C", lastName: "D" });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
         VALUES ('mail-2', ?, 'other@example-works.test', 'other@example-works.test', ?, 'registration_confirmation', ?)`,
      ).bind(other.id, now, now),
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, email_id, job_title, source, invited_at, started_at, created_at, updated_at)
         VALUES ('identity-2', ?, 'org-1', 'mail-2', 'Engineer', 'verified_domain', ?, ?, ?, ?)`,
      ).bind(other.id, now, now, now, now),
    ]);
    expect(await quote("identity-2")).toMatchObject({ total: 19500, personalEmailPrice: true });
    expect((await readEventTicketOffer(env.DB, {}, event, who, "identity-2")).personalEmail).toBe(true);
    // The identity is free for the person it belongs to.
    expect(
      await quoteEventTicket(
        env.DB,
        {},
        event,
        { userId: other.id, email: other.email },
        {
          dayAttendance: inPerson,
          identityId: "identity-2",
          save: false,
        },
      ),
    ).toMatchObject({ total: 0, personalEmailPrice: false });
  });

  it("decides the ticket once per organization and reuses the stored decision", async () => {
    const { event } = await seedTickets();
    const first = await register(
      event,
      "one@vendor-example.test",
      classifier({ pqcc_vendor: 0.97, pqcc_attendee: 0.03 }),
    );
    expect(first.ticket).toMatchObject({ ticketName: "Vendor", amount: 39500 });
    // No classifier this time: the stored decision for the organization and domain still applies.
    const second = await register(event, "two@vendor-example.test");
    expect(second.ticket).toMatchObject({ ticketName: "Vendor" });
  });

  it("lets the person choose when the classifier is unsure and falls back to the default when it fails", async () => {
    const { event } = await seedTickets();
    const unsure = classifier({ pqcc_vendor: 0.6, pqcc_attendee: 0.4 });
    const user = await findOrCreateUser(env.DB, {
      email: "chooser@unsure-example.test",
      firstName: "A",
      lastName: "B",
    });
    const identity = { userId: user.id, email: user.email };
    expect((await readEventTicketOffer(env.DB, unsure, event, identity)).assigned).toBeNull();
    const quote = await quoteEventTicket(env.DB, unsure, event, identity, {
      dayAttendance: inPerson,
      ticketKey: "pqcc_vendor",
      save: true,
    });
    expect(quote).toMatchObject({ ticketKey: "pqcc_vendor", source: "chosen", total: 39500, nextTotal: 49500 });
    const failing: Pick<Env, "AI"> = { AI: { run: async () => Promise.reject(new Error("unavailable")) } };
    const fallback = await register(event, "other@failing-example.test", failing);
    expect(fallback.ticket).toMatchObject({ ticketName: "Attendee" });
  });

  it("requires a reason to hold another ticket than the one decided, and an organizer can move it back", async () => {
    const { event, admin } = await seedTickets();
    const decided = classifier({ pqcc_vendor: 0.99, pqcc_attendee: 0.01 });
    const user = await findOrCreateUser(env.DB, {
      email: "dispute@vendor-example.test",
      firstName: "A",
      lastName: "B",
    });
    const identity = { userId: user.id, email: user.email };
    await expect(
      quoteEventTicket(env.DB, decided, event, identity, {
        dayAttendance: inPerson,
        ticketKey: "pqcc_attendee",
        save: false,
      }),
    ).rejects.toMatchObject({ code: "TICKET_DISPUTE_REASON_REQUIRED" });
    await quoteEventTicket(env.DB, decided, event, identity, {
      dayAttendance: inPerson,
      ticketKey: "pqcc_attendee",
      disputeReason: "We only buy these products.",
      save: true,
    });
    const { registration, ticket } = await register(event, user.email, decided);
    expect(ticket).toMatchObject({ ticketName: "Attendee", status: "free" });
    expect(await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id })).toMatchObject({
      disputed: true,
      source: "disputed",
    });
    // The person registers again between the organizer's read and the write: the review is refused whole,
    // with no audit entry and no organizer decision left behind.
    const replanned = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.prepare("UPDATE registration_tickets SET revision = revision + 1 WHERE registration_id = ?")
          .bind(registration.id)
          .run();
        return env.DB.batch(statements);
      },
    } as unknown as typeof env.DB;
    for (const decision of ["keep", "move"] as const)
      await expect(
        reviewDisputedTicket(
          replanned,
          admin as UserBackedAuthAdmin,
          event,
          registration.id,
          decision,
          "https://example.test",
        ),
      ).rejects.toMatchObject({ code: "TICKET_NOT_DISPUTED" });
    expect(
      await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM audit_log WHERE action = 'registration_ticket_dispute_settled') AS audits,
                (SELECT COUNT(*) FROM ticket_classifier_decisions WHERE source = 'organizer') AS decisions`,
      ).first(),
    ).toEqual({ audits: 0, decisions: 0 });
    expect(await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id })).toMatchObject({
      disputed: true,
      ticketKey: "pqcc_attendee",
    });
    await reviewDisputedTicket(
      env.DB,
      admin as UserBackedAuthAdmin,
      event,
      registration.id,
      "move",
      "https://example.test",
    );
    expect(await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id })).toMatchObject({
      ticketKey: "pqcc_vendor",
      status: "pending_payment",
      amount: 39500,
      disputed: false,
    });
  });

  it("counts a code's uses with the registration and refuses the one after the last", async () => {
    const { event, admin, vendor } = await seedTickets();
    const code = await createEventTicketCode(env.DB, admin, event, {
      ticketTypeId: vendor.id,
      label: "Example sponsor: staff",
      discount: "amount",
      amount: 0,
      maxUses: 1,
    });
    const claim = async (email: string) => {
      const user = await findOrCreateUser(env.DB, { email, firstName: "A", lastName: "B" });
      await quoteEventTicket(
        env.DB,
        {},
        event,
        { userId: user.id, email },
        { dayAttendance: inPerson, code: code.code.toLowerCase(), save: true },
      );
      return register(event, email);
    };
    expect((await claim("staff@sponsor-example.test")).ticket).toMatchObject({
      ticketName: "Vendor",
      amount: 0,
      status: "free",
    });
    const user = await findOrCreateUser(env.DB, { email: "late@sponsor-example.test", firstName: "A", lastName: "B" });
    await expect(
      quoteEventTicket(
        env.DB,
        {},
        event,
        { userId: user.id, email: user.email },
        { dayAttendance: inPerson, code: code.code, save: false },
      ),
    ).rejects.toMatchObject({ code: "TICKET_CODE_USED_UP" });
    await expect(updateEventTicketCode(env.DB, admin, event, code.id, { maxUses: 0 })).rejects.toBeTruthy();
    // Adding uses raises whatever the limit is by now, so two organizers adding ten both count.
    await updateEventTicketCode(env.DB, admin, event, code.id, { addUses: 10 });
    await updateEventTicketCode(env.DB, admin, event, code.id, { addUses: 10 });
    expect(await env.DB.prepare("SELECT max_uses FROM event_ticket_codes WHERE id = ?").bind(code.id).first()).toEqual({
      max_uses: 21,
    });
    expect(isTicketCodeExhausted(new Error("CHECK constraint failed: used_count <= max_uses"))).toBe(true);
  });

  it("marks a ticket paid only for a matching payment, once, and releases the held confirmation", async () => {
    const { event, admin } = await seedTickets();
    const { registration, user } = await register(event, "buyer@gmail.com");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO email_outbox (id, template_key, recipient_email, payload_json, message_type, provider, status, send_after, created_at, updated_at)
       VALUES ('held-1', 'registration_confirmed', ?, '{}', 'transactional', 'sendgrid', 'queued', '9999-12-31T00:00:00.000Z', ?, ?)`,
    )
      .bind(user.email, now, now)
      .run();
    await env.DB.prepare("UPDATE registration_tickets SET held_email_id = 'held-1' WHERE registration_id = ?")
      .bind(registration.id)
      .run();
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    const opened = await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    expect(opened.checkoutUrl).toContain("checkout.stripe.com");
    // A second click reuses the open session instead of creating another.
    expect(await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe)).toEqual(opened);
    const ticket = (await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id }))!;

    expect(await paidEvent(ticket.id, "cs_test_ticket", 100)).toMatchObject({ outcome: "rejected_mismatch" });
    expect((await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id }))!.status).toBe(
      "pending_payment",
    );
    expect(await paidEvent(ticket.id, "cs_test_ticket", 19500, "evt_paid")).toMatchObject({ outcome: "paid" });
    expect(await paidEvent(ticket.id, "cs_test_ticket", 19500, "evt_paid")).toMatchObject({ outcome: "duplicate" });
    expect((await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id }))!.status).toBe(
      "paid",
    );
    const held = await env.DB.prepare("SELECT send_after FROM email_outbox WHERE id = 'held-1'").first<{
      send_after: string;
    }>();
    expect(held!.send_after < "9999").toBe(true);
    const ledger = await env.DB.prepare(
      "SELECT status, amount FROM payment_ledger_entries WHERE purpose = 'event'",
    ).first<{ status: string; amount: number }>();
    expect(ledger).toMatchObject({ status: "paid", amount: 19500 });
    // A ticket was paid in the event's currency, so the currency can no longer change.
    const configuration = await readEventTicketsConfiguration(env.DB, event);
    await expect(
      updateEventTicketSettings(env.DB, admin, event, {
        expectedRevision: configuration.revision,
        currency: "eur",
        reminderIntervalDays: configuration.settings.reminderIntervalDays,
        reminderPeriodDays: configuration.settings.reminderPeriodDays,
        sendInvoice: configuration.settings.sendInvoice,
      }),
    ).rejects.toMatchObject({ code: "TICKET_CURRENCY_FIXED" });
  });

  it("refunds a paid ticket through the refund job and the provider's refund event", async () => {
    const { event, admin } = await seedTickets();
    const { registration, user } = await register(event, "refund@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await expect(requestTicketRefund(env.DB, admin, { ...input, reason: "Visa refused" })).rejects.toMatchObject({
      code: "TICKET_NOT_REFUNDABLE",
    });
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const ticket = (await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id }))!;
    await paidEvent(ticket.id, "cs_test_ticket", 19500);
    // Part of the payment returned in the provider's dashboard leaves the ticket and its ledger entry paid.
    expect(
      await handleEventTicketStripeEvent(env.DB, {
        id: "evt_partial_refund",
        type: "charge.refunded",
        data: {
          object: { id: "ch_synthetic", payment_intent: "pi_synthetic", refunded: false, amount_refunded: 2000 },
        },
      }),
    ).toMatchObject({ outcome: "partially_refunded" });
    expect(await env.DB.prepare("SELECT status FROM payment_ledger_entries WHERE purpose = 'event'").first()).toEqual({
      status: "paid",
    });
    await requestTicketRefund(env.DB, admin, { ...input, reason: "Visa refused" });
    await expect(requestTicketRefund(env.DB, admin, { ...input, reason: "Again" })).rejects.toMatchObject({
      code: "TICKET_REFUND_PENDING",
    });
    let sent: string | null = null;
    const refunds = (async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ id: "re_synthetic", status: "pending" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await processTicketRefunds(env.DB, paymentEnv, 5, refunds)).toEqual({ processed: 1, failed: 0 });
    expect(sent).toContain("payment_intent=pi_synthetic");
    // Only what the provider has not returned yet is asked back.
    expect(sent).toContain("amount=17500");
    // The refund is at Stripe but its event has not arrived: the ticket still reads paid and is not refunded twice.
    await expect(requestTicketRefund(env.DB, admin, { ...input, reason: "Again" })).rejects.toMatchObject({
      code: "TICKET_REFUND_PENDING",
    });
    await handleEventTicketStripeEvent(env.DB, {
      id: "evt_refund",
      type: "charge.refunded",
      data: { object: { id: "ch_synthetic", payment_intent: "pi_synthetic", refunded: true, amount_refunded: 19500 } },
    });
    expect(await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id })).toMatchObject({
      status: "refunded",
      refundedAmount: 19500,
    });
  });

  it("lets an organizer refund again after the provider fails or refuses a refund", async () => {
    const { event, admin } = await seedTickets();
    const { registration, user } = await register(event, "refund-failed@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
    await paidEvent((await read())!.id, "cs_test_ticket", 19500);
    const answer = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

    // The provider confirms the refund at once, then fails it: the ticket is paid again and can be refunded again.
    await requestTicketRefund(env.DB, admin, { ...input, reason: "Visa refused" });
    await processTicketRefunds(env.DB, paymentEnv, 5, answer(200, { id: "re_first", status: "succeeded" }));
    expect(await read()).toMatchObject({ status: "refunded", refundedAmount: 19500, refundPending: false });
    const failure = {
      type: "refund.failed",
      data: {
        object: { id: "re_first", payment_intent: "pi_synthetic", amount: 19500, status: "failed" },
      },
    };
    expect(await handleEventTicketStripeEvent(env.DB, { id: "evt_refund_failed", ...failure })).toMatchObject({
      outcome: "refund_failed",
    });
    // The same failure under another event changes nothing more.
    await handleEventTicketStripeEvent(env.DB, { id: "evt_refund_failed_again", ...failure, type: "refund.updated" });
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 0, refundPending: false, refundFailed: true });

    // A refund the provider refuses outright is failed without further tries.
    await requestTicketRefund(env.DB, admin, { ...input, reason: "Second try" });
    expect(await processTicketRefunds(env.DB, paymentEnv, 5, answer(400, {}))).toEqual({ processed: 0, failed: 1 });
    expect(await read()).toMatchObject({ status: "paid", refundPending: false, refundFailed: true });

    await requestTicketRefund(env.DB, admin, { ...input, reason: "Third try" });
    await processTicketRefunds(env.DB, paymentEnv, 5, answer(200, { id: "re_third", status: "pending" }));
    expect(await read()).toMatchObject({ status: "paid", refundPending: true, refundFailed: false });
    await handleEventTicketStripeEvent(env.DB, {
      id: "evt_refund_confirmed",
      type: "refund.updated",
      data: { object: { id: "re_third", payment_intent: "pi_synthetic", amount: 19500, status: "succeeded" } },
    });
    expect(await read()).toMatchObject({ status: "refunded", refundedAmount: 19500, refundPending: false });
  });

  it("returns a payment that arrives after the ticket was canceled and closes its payment page", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "late-payment@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
    const ticket = (await read())!;
    await env.DB.prepare("UPDATE registration_tickets SET status = 'canceled' WHERE id = ?").bind(ticket.id).run();

    // The payment page of a canceled ticket is closed at the provider by the job.
    const calls: string[] = [];
    const provider = (async (url: string, init: RequestInit) => {
      calls.push(`${url} ${String(init.body ?? "")}`);
      return new Response(JSON.stringify({ id: "re_late", status: "succeeded" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await closeUnpayableTicketCheckouts(env.DB, paymentEnv, 10, provider)).toEqual({ closed: 1 });
    expect(calls[0]).toContain("/v1/checkout/sessions/cs_test_ticket/expire");
    expect(await closeUnpayableTicketCheckouts(env.DB, paymentEnv, 10, provider)).toEqual({ closed: 0 });

    // A payment that still got through is returned by itself, once, and the ticket stays canceled.
    expect(await paidEvent(ticket.id, "cs_test_ticket", 19500)).toMatchObject({ outcome: "returned" });
    expect(await read()).toMatchObject({ status: "canceled", refundPending: true, paymentReference: "pi_synthetic" });
    expect(await processTicketRefunds(env.DB, paymentEnv, 5, provider)).toEqual({ processed: 1, failed: 0 });
    expect(calls.at(-1)).toContain("payment_intent=pi_synthetic");
    expect(calls.at(-1)).toContain("amount=19500");
    expect(await read()).toMatchObject({ status: "canceled", refundPending: false, refundFailed: false });
    expect(await processTicketRefunds(env.DB, paymentEnv, 5, provider)).toEqual({ processed: 0, failed: 0 });
  });

  it("applies refund facts in the provider's order and takes back only what a failed refund had added", async () => {
    const { event, admin } = await seedTickets();
    const { registration, user } = await register(event, "refund-order@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
    await paidEvent((await read())!.id, "cs_test_ticket", 19500);
    const charge = (id: string, created: number, amount: number, refunded = false) =>
      handleEventTicketStripeEvent(env.DB, {
        id,
        type: "charge.refunded",
        created,
        data: { object: { id: "ch_synthetic", payment_intent: "pi_synthetic", refunded, amount_refunded: amount } },
      });
    const failed = (id: string, created: number, refund: string, refundCreated: number, amount: number) =>
      handleEventTicketStripeEvent(env.DB, {
        id,
        type: "refund.failed",
        created,
        data: {
          object: { id: refund, payment_intent: "pi_synthetic", amount, status: "failed", created: refundCreated },
        },
      });
    // 2000 was returned at the provider. A second refund of 17500 fails before any total included it:
    // the 2000 that did go back stays counted.
    await charge("evt_total_1", 1000, 2000);
    await failed("evt_failed_1", 1200, "re_never_counted", 1100, 17500);
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000 });
    // The total that did include it arrives late, after the failure: it is older than the failure and is left out.
    await charge("evt_total_late", 1150, 19500, true);
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000 });
    // A refund the last applied total did include is taken off when it fails.
    await charge("evt_total_2", 1300, 5000);
    await failed("evt_failed_2", 1400, "re_counted", 1250, 3000);
    await failed("evt_failed_2_again", 1401, "re_counted", 1250, 3000);
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000 });

    // A refund of ours made after a total was reported is not part of that total, also when the total arrives late.
    await requestTicketRefund(env.DB, admin, { ...input, reason: "The rest" });
    const pending = (async () =>
      new Response(JSON.stringify({ id: "re_ours", status: "pending", created: 2000 }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(await processTicketRefunds(env.DB, paymentEnv, 5, pending)).toEqual({ processed: 1, failed: 0 });
    // Reported in the same second as our refund, just before it: the time alone cannot tell them apart,
    // but a total that did not grow by the refund's amount does not hold it.
    await charge("evt_total_before_ours", 2000, 2000);
    expect(
      await env.DB.prepare(
        "SELECT amount, counted FROM registration_ticket_refunds WHERE provider_refund_id = 're_ours'",
      ).first(),
    ).toEqual({ amount: 17500, counted: 0 });
    await failed("evt_failed_ours", 2100, "re_ours", 2000, 17500);
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000, refundFailed: true });
    // A total that grew by the refund's amount does hold it, and its failure takes exactly that off again.
    await requestTicketRefund(env.DB, admin, { ...input, reason: "The rest, again" });
    const again = (async () =>
      new Response(JSON.stringify({ id: "re_ours_2", status: "pending", created: 3000 }), {
        status: 200,
      })) as unknown as typeof fetch;
    await processTicketRefunds(env.DB, paymentEnv, 5, again);
    await charge("evt_total_with_ours", 3000, 19500, true);
    expect(await read()).toMatchObject({ status: "refunded", refundedAmount: 19500 });
    await failed("evt_failed_ours_2", 3100, "re_ours_2", 3000, 17500);
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000 });
  });

  it("returns a payment made on a page for an earlier price and leaves the ticket to be paid", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "old-price@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
    const ticket = (await read())!;
    await env.DB.prepare("UPDATE registration_tickets SET amount = 39500 WHERE id = ?").bind(ticket.id).run();
    // The page asked for 19500 and that is what was paid, but the ticket costs 39500 by now.
    expect(await paidEvent(ticket.id, "cs_test_ticket", 19500)).toMatchObject({ outcome: "returned" });
    expect(await read()).toMatchObject({ status: "pending_payment", amount: 39500, refundPending: true });
    expect(
      await env.DB.prepare("SELECT amount, payment_intent_id FROM registration_ticket_refunds WHERE ticket_id = ?")
        .bind(ticket.id)
        .first(),
    ).toEqual({ amount: 19500, payment_intent_id: "pi_synthetic" });
  });

  it("does not restore a code-backed ticket once its pass went to someone else", async () => {
    const { event, admin, vendor } = await seedTickets();
    const code = await createEventTicketCode(env.DB, admin, event, {
      ticketTypeId: vendor.id,
      label: "Example sponsor: staff",
      discount: "amount",
      amount: 0,
      maxUses: 1,
    });
    const claim = async (email: string) => {
      const user = await findOrCreateUser(env.DB, { email, firstName: "A", lastName: "B" });
      await quoteEventTicket(
        env.DB,
        {},
        event,
        { userId: user.id, email },
        {
          dayAttendance: inPerson,
          code: code.code,
          save: true,
        },
      );
      return register(event, email);
    };
    const first = await claim("first@sponsor-example.test");
    const now = new Date().toISOString();
    await env.DB.batch(prepareCancelRegistrationTicket(env.DB, first.registration.id, now));
    await claim("second@sponsor-example.test");
    await expect(assertRegistrationTicketRestorable(env.DB, first.registration.id)).rejects.toMatchObject({
      code: "TICKET_CODE_USED_UP",
    });
    // The write itself refuses too, so a pass taken between the check and the write is not handed out twice.
    await expect(
      env.DB.batch(prepareRestoreRegistrationTicket(env.DB, first.registration.id, now)),
    ).rejects.toBeTruthy();
    expect(
      await env.DB.prepare("SELECT used_count FROM event_ticket_codes WHERE id = ?").bind(code.id).first(),
    ).toEqual({ used_count: 1 });
    expect(
      await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: first.registration.id }),
    ).toMatchObject({ status: "canceled" });
  });

  it("gives each active sponsor its two codes from its tier and only ever raises their limits", async () => {
    const { event, admin, attendee, vendor } = await seedTickets();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO sponsorships (id, sponsor_type, non_member_name, event_id, tier, pipeline_stage, created_at, updated_at)
       VALUES ('sponsor-1', 'event', 'Example Sponsor', ?, 'Gold', 'active', ?, ?),
              ('sponsor-2', 'event', 'Pending Sponsor', ?, 'Gold', 'payment_pending', ?, ?)`,
    )
      .bind(event.id, now, now, event.id, now, now)
      .run();
    await expect(issueSponsorPassCodes(env.DB, admin, event)).rejects.toMatchObject({
      code: "SPONSOR_PASSES_UNAVAILABLE",
    });
    const save = async (staffPasses: number, customerPasses: number) =>
      saveSponsorPasses(env.DB, admin, event, {
        expectedRevision: (await readEventTicketsConfiguration(env.DB, event)).revision,
        staffTicketTypeId: vendor.id,
        customerTicketTypeId: attendee.id,
        tiers: [{ tierName: "Gold", staffPasses, customerPasses, sponsors: 0, sponsorsWithCodes: 0 }],
      });
    await save(4, 8);
    expect(await issueSponsorPassCodes(env.DB, admin, event)).toEqual({ created: 2, raised: 0 });
    expect(await issueSponsorPassCodes(env.DB, admin, event)).toEqual({ created: 0, raised: 0 });
    // The early-payment bonus: three customer invitations per staff pass instead of two.
    await save(4, 12);
    expect(await issueSponsorPassCodes(env.DB, admin, event)).toEqual({ created: 0, raised: 1 });
    await save(2, 4);
    expect(await issueSponsorPassCodes(env.DB, admin, event)).toEqual({ created: 0, raised: 0 });
    const configuration = await readEventTicketsConfiguration(env.DB, event);
    const listed = await listEventTicketCodes(env.DB, event.id, eventTicketCodeListQuerySchema.parse({}));
    expect(listed.page.total).toBe(2);
    expect(
      (await listEventTicketCodes(env.DB, event.id, eventTicketCodeListQuerySchema.parse({ q: "customers", limit: 1 })))
        .codes,
    ).toMatchObject([{ label: "Example Sponsor: customers" }]);
    expect(listed.codes.map((code) => [code.label, code.maxUses, code.amount]).sort()).toEqual([
      ["Example Sponsor: customers", 12, 0],
      ["Example Sponsor: staff", 4, 0],
    ]);
    expect(configuration.sponsorPasses.tiers).toEqual([
      { tierName: "Gold", staffPasses: 2, customerPasses: 4, sponsors: 1, sponsorsWithCodes: 1 },
    ]);
  });

  it("keeps a registration with an unpaid ticket out of badge and scanner eligibility until it is paid", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "unpaid@gmail.com");
    const eligible = async () =>
      (await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM registrations r JOIN users u ON u.id = r.user_id
           WHERE r.id = ? AND ${badgeAttendeeEligibilitySql("r", "u")}`,
      )
        .bind(registration.id)
        .first<{ total: number }>())!.total;
    expect(await eligible()).toBe(0);
    await openTicketCheckout(
      env.DB,
      paymentEnv,
      "https://example.test",
      { eventId: event.id, registrationId: registration.id, userId: user.id },
      stripe,
    );
    const ticket = (await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id }))!;
    await paidEvent(ticket.id, "cs_test_ticket", 19500);
    expect(await eligible()).toBe(1);
  });

  it("takes a registrant from the mounted checkout route through the signed webhook to a paid ticket", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "journey@gmail.com");
    const token = await createMemberSession(env.DB, user.id, `session-${crypto.randomUUID()}`);
    const routeEnv = { ...paymentEnv, STRIPE_WEBHOOK_SECRET: "whsec_synthetic_ticket" } as Env;
    const path = `/api/v1/events/pqc-2026/registrations/${registration.id}/ticket`;
    const authorized = { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
    let stripeRequest: URLSearchParams | null = null;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      stripeRequest = new URLSearchParams(String(init.body));
      return Response.json({ id: "cs_test_route", url: "https://checkout.stripe.com/c/pay/cs_test_route" });
    });
    try {
      // Someone else cannot open payment for this registration, and a guest is refused.
      expect((await callApi(routeEnv, `${path}/checkout`, { method: "POST" })).status).toBe(401);
      const stranger = await findOrCreateUser(env.DB, { email: "stranger@gmail.com", firstName: "E", lastName: "F" });
      const strangerToken = await createMemberSession(env.DB, stranger.id, `session-${crypto.randomUUID()}`);
      const foreign = { headers: { authorization: `Bearer ${strangerToken}`, "content-type": "application/json" } };
      expect((await callApi(routeEnv, `${path}/checkout`, { method: "POST", body: "{}", ...foreign })).status).toBe(
        404,
      );
      expect((await callApi(routeEnv, path, foreign)).status).toBe(403);
      expect(stripeRequest).toBeNull();
      const opened = await callApi(routeEnv, `${path}/checkout`, { method: "POST", body: "{}", ...authorized });
      expect(opened.status).toBe(200);
      expect(registrationTicketCheckoutResponseSchema.parse(await opened.json()).checkoutUrl).toContain(
        "cs_test_route",
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(stripeRequest!.get("line_items[0][price_data][unit_amount]")).toBe("19500");
    expect(stripeRequest!.get("metadata[pkic_payment_type]")).toBe("event");
    // Stripe carries our registration as its reference, and the buyer may add their own.
    expect(stripeRequest!.get("client_reference_id")).toBe(registration.id);
    expect(stripeRequest!.get("metadata[registrationId]")).toBe(registration.id);
    expect(stripeRequest!.get("custom_fields[0][optional]")).toBe("true");
    // Invoices are on unless the event turns them off, and then the buyer's business details are asked for.
    expect(stripeRequest!.get("invoice_creation[enabled]")).toBe("true");
    expect(stripeRequest!.get("tax_id_collection[enabled]")).toBe("true");
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: "evt_route_paid",
      type: "checkout.session.completed",
      created: timestamp,
      data: {
        object: {
          id: "cs_test_route",
          payment_intent: "pi_route",
          amount_total: 19500,
          currency: "usd",
          payment_status: "paid",
          metadata: {
            pkic_payment_type: "event",
            registrationTicketId: stripeRequest!.get("metadata[registrationTicketId]"),
          },
        },
      },
    });
    const webhook = (signature: string) =>
      callApi(routeEnv, "/api/v1/webhooks/stripe", {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
        body,
      });
    expect((await webhook("bad")).status).toBeGreaterThanOrEqual(400);
    const signed = await webhook(await hmacSha256Hex("whsec_synthetic_ticket", `${timestamp}.${body}`));
    expect(signed.status).toBe(200);
    const read = await callApi(routeEnv, path, authorized);
    expect(registrationTicketResponseSchema.parse(await read.json()).ticket).toMatchObject({
      status: "paid",
      amount: 19500,
    });
  });
  it("closes a checkout opened for another amount instead of offering it again", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "changed@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    const calls: Array<{ url: string; body: string }> = [];
    const provider = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: String(init.body ?? "") });
      const id = `cs_test_${calls.length}`;
      return new Response(JSON.stringify({ id, url: `https://checkout.stripe.com/c/pay/${id}` }), { status: 200 });
    }) as unknown as typeof fetch;
    const first = await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, provider);
    // The buyer pays the event's currency: a local-currency amount would not settle the ticket.
    expect(new URLSearchParams(calls[0].body).get("adaptive_pricing[enabled]")).toBe("false");
    await env.DB.prepare("UPDATE registration_tickets SET amount = 39500 WHERE registration_id = ?")
      .bind(registration.id)
      .run();
    const second = await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, provider);
    expect(second.checkoutUrl).not.toBe(first.checkoutUrl);
    expect(calls[1].url).toContain("/v1/checkout/sessions/cs_test_1/expire");
    expect(new URLSearchParams(calls[2].body).get("line_items[0][price_data][unit_amount]")).toBe("39500");
  });

  it("keeps a code when the registration is planned again and gives it back when the registration is cancelled", async () => {
    const { event, admin, vendor } = await seedTickets();
    const code = await createEventTicketCode(env.DB, admin, event, {
      ticketTypeId: vendor.id,
      label: "Example sponsor: staff",
      discount: "amount",
      amount: 0,
      maxUses: 1,
    });
    const user = await findOrCreateUser(env.DB, { email: "guest@gmail.com", firstName: "A", lastName: "B" });
    const who = { userId: user.id, email: user.email };
    await quoteEventTicket(env.DB, {}, event, who, { dayAttendance: inPerson, code: code.code, save: true });
    const { registration } = await register(event, user.email);
    const uses = async () =>
      (await env.DB.prepare("SELECT used_count FROM event_ticket_codes WHERE id = ?").bind(code.id).first<{
        used_count: number;
      }>())!.used_count;
    const plan = async () => {
      const ticket = await planRegistrationTicket(
        env.DB,
        {},
        {
          event,
          registrationId: registration.id,
          userId: user.id,
          email: user.email,
          identityId: null,
          dayAttendance: inPerson,
        },
      );
      await env.DB.batch(ticket!.statements);
      return ticket!;
    };
    // Planned again without the ticket step: the same code ticket, and its pass is counted once.
    expect(await plan()).toMatchObject({ ticketName: "Vendor", amount: 0, status: "free" });
    expect(await uses()).toBe(1);
    await env.DB.batch(prepareCancelRegistrationTicket(env.DB, registration.id, new Date().toISOString()));
    expect(await uses()).toBe(0);
    expect((await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id }))!.status).toBe(
      "canceled",
    );
    // A canceled ticket holds no code: registering again gets the ticket anyone would.
    expect(await plan()).toMatchObject({ ticketName: "Attendee", status: "pending_payment" });
    expect(await uses()).toBe(0);
  });

  it("releases the held confirmation when a review moves the ticket to one that costs nothing", async () => {
    const { event, admin } = await seedTickets();
    const decided = classifier({ pqcc_attendee: 0.99, pqcc_vendor: 0.01 });
    const user = await findOrCreateUser(env.DB, { email: "buyer@user-example.test", firstName: "A", lastName: "B" });
    await quoteEventTicket(
      env.DB,
      decided,
      event,
      { userId: user.id, email: user.email },
      { dayAttendance: inPerson, ticketKey: "pqcc_vendor", disputeReason: "We also sell.", save: true },
    );
    const { registration, ticket } = await register(event, user.email, decided);
    expect(ticket).toMatchObject({ ticketName: "Vendor", status: "pending_payment" });
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO email_outbox (id, template_key, recipient_email, payload_json, message_type, provider, status, send_after, created_at, updated_at)
       VALUES ('held-2', 'registration_confirmed', ?, '{}', 'transactional', 'sendgrid', 'queued', '9999-12-31T00:00:00.000Z', ?, ?)`,
    )
      .bind(user.email, now, now)
      .run();
    // A ticket with nothing to pay holds nothing; an unpaid one holds the confirmation and asks for payment.
    expect(
      await prepareHoldConfirmationForPayment(env.DB, "https://example.test", {
        registrationId: crypto.randomUUID(),
        outboxId: "held-2",
      }),
    ).toEqual([]);
    await env.DB.batch(
      await prepareHoldConfirmationForPayment(env.DB, "https://example.test", {
        registrationId: registration.id,
        outboxId: "held-2",
      }),
    );
    await reviewDisputedTicket(
      env.DB,
      admin as UserBackedAuthAdmin,
      event,
      registration.id,
      "move",
      "https://example.test",
    );
    expect(await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id })).toMatchObject({
      ticketKey: "pqcc_attendee",
      status: "free",
    });
    const held = await env.DB.prepare("SELECT send_after FROM email_outbox WHERE id = 'held-2'").first<{
      send_after: string;
    }>();
    expect(held!.send_after < "9999").toBe(true);
  });

  it("reminds an unpaid ticket once it is due and not a registration that is cancelled", async () => {
    const { event } = await seedTickets();
    const due = await register(event, "due@gmail.com");
    const gone = await register(event, "gone@gmail.com");
    await env.DB.prepare("UPDATE registration_tickets SET next_reminder_at = '2000-01-01T00:00:00.000Z'").run();
    await env.DB.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").bind(gone.registration.id).run();
    expect(await sendTicketPaymentReminders(env.DB, "https://example.test")).toEqual({ reminded: 1 });
    const sent = await env.DB.prepare(
      "SELECT recipient_email FROM email_outbox WHERE idempotency_key LIKE 'ticket-reminder:%'",
    ).all<{ recipient_email: string }>();
    expect(sent.results.map((row) => row.recipient_email)).toEqual([due.user.email]);
  });
});
