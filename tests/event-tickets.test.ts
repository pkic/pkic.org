import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { insertOrganization, insertUser } from "./helpers/membership";
import { nowIso } from "../functions/_lib/utils/time";
import { workEmailDomain } from "../functions/_lib/email-domains/classification";
import { ticketRefundNote } from "../assets/shared/event-ticket-display";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { hmacSha256Hex } from "../functions/_lib/utils/crypto";
import { eventTicketSettingsUpdateSchema } from "../assets/shared/schemas/event-tickets";
import {
  registrationTicketCheckoutResponseSchema,
  registrationTicketResponseSchema,
} from "../assets/shared/schemas/registration-tickets";
import {
  eventTicketCodeListQuerySchema,
  eventTicketSponsorListQuerySchema,
} from "../assets/shared/schemas/event-ticket-codes";
import { seedEventAndAdmin } from "./helpers/context";
import { createScheduledRegistration } from "./helpers/scheduled-registration";
import { findOrCreateUser } from "../functions/_lib/services/users";
import {
  createEventTicketCode,
  readEventTicketsConfiguration,
  replaceEventTicketPrices,
  saveEventTicketType,
  updateEventTicketCode,
  updateEventTicketGuidance,
  updateEventTicketSettings,
} from "../functions/_lib/services/event-tickets/configuration";
import { quoteEventTicket, readEventTicketOffer } from "../functions/_lib/services/event-tickets/offer";
import {
  isTicketCodeSpent,
  planRegistrationTicket,
  assertRegistrationTicketRestorable,
  prepareCancelRegistrationTicket,
  prepareRestoreRegistrationTicket,
  readRegistrationTicket,
  ticketPaymentDisputedSql,
} from "../functions/_lib/services/event-tickets/registration-ticket";
import { handleEventTicketStripeEvent, openTicketCheckout } from "../functions/_lib/services/event-tickets/payment";
import { dispatchStripePaymentEvent } from "../functions/_lib/services/payments/stripe-webhook";
import {
  prepareHoldConfirmationForPayment,
  sendTicketPaymentReminders,
} from "../functions/_lib/services/event-tickets/payment-emails";
import {
  closeUnpayableTicketCheckouts,
  processTicketRefunds,
  reconcileTicketRefunds,
  requestTicketRefund,
} from "../functions/_lib/services/event-tickets/refunds";
import { syncRegistrationTicketWithProvider } from "../functions/_lib/services/event-tickets/provider-sync";
import {
  listIssuedTickets,
  updateIssuedTicketsFromProvider,
} from "../functions/_lib/services/event-tickets/issued-list";
import { issuedTicketsQuerySchema } from "../assets/shared/schemas/event-issued-tickets";
import { releaseUnpaidTickets } from "../functions/_lib/services/event-tickets/unpaid-release";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { listEventTicketCodes } from "../functions/_lib/services/event-tickets/code-list";
import { listEventTicketSponsors } from "../functions/_lib/services/event-tickets/event-sponsors";
import { reviewDisputedTicket } from "../functions/_lib/services/event-tickets/dispute";
import {
  decideOrganizationTicket,
  prepareStoreTicketDecision,
} from "../functions/_lib/services/event-tickets/classifier";
import { readEventTicketSnapshot } from "../functions/_lib/services/event-tickets/snapshot";
import { issueSponsorPassCodes, saveSponsorPasses } from "../functions/_lib/services/event-tickets/sponsor-passes";
import { getRegistrationByIdForEvent } from "../functions/_lib/services/registrations/queries";
import { buildRegistrationUpdate } from "../functions/_lib/services/registrations/update-plan";
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

/** The portal organization that claims a domain, created on first use. */
async function organizationFor(domain: string): Promise<string> {
  const claimed = await env.DB.prepare("SELECT organization_id FROM organization_domain_claims WHERE domain = ?")
    .bind(domain)
    .first<{ organization_id: string }>();
  if (claimed) return claimed.organization_id;
  const organizationId = await insertOrganization(env.DB, `Organization at ${domain}`);
  const at = nowIso();
  await env.DB.prepare(
    "INSERT INTO organization_domain_claims (id, domain, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), domain, organizationId, at, at)
    .run();
  return organizationId;
}

/** Registers a person, on behalf of the organization that claims their domain unless it is a personal mail domain. */
async function register(event: { id: string; timezone: string }, email: string, classifierEnv: Pick<Env, "AI"> = {}) {
  const user = await findOrCreateUser(env.DB, { email, firstName: "Synthetic", lastName: "Person" });
  const domain = workEmailDomain(email);
  let identityId: string | null = null;
  if (domain) {
    identityId = crypto.randomUUID();
    const at = nowIso();
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, invited_at, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'verified_domain', ?, ?, ?, ?)`,
    )
      .bind(identityId, user.id, await organizationFor(domain), at, at, at, at)
      .run();
  }
  const { registration } = await createScheduledRegistration(env.DB, {
    event: { id: event.id },
    userId: user.id,
    sourceType: "direct",
    verifiedIdentity: { userId: user.id },
  });
  const ticket = await planRegistrationTicket(env.DB, classifierEnv, {
    event,
    registrationId: registration.id,
    userId: user.id,
    email,
    identityId,
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
    const { event, admin } = await seedTickets();
    const first = await register(
      event,
      "one@vendor-example.test",
      classifier({ pqcc_vendor: 0.97, pqcc_attendee: 0.03 }),
    );
    expect(first.ticket).toMatchObject({ ticketName: "Vendor", amount: 39500 });
    // No classifier this time: the stored decision for the organization and domain still applies.
    const second = await register(event, "two@vendor-example.test");
    expect(second.ticket).toMatchObject({ ticketName: "Vendor" });

    // Tuning the question keeps the decision: a new description and a stricter threshold ask nothing again.
    const configuration = await readEventTicketsConfiguration(env.DB, event);
    const vendor = configuration.types.find((type) => type.key === "pqcc_vendor")!;
    await saveEventTicketType(env.DB, admin, event, vendor.id, {
      expectedRevision: configuration.revision,
      key: vendor.key,
      name: vendor.name,
      descriptionMarkdown: vendor.descriptionMarkdown,
      classifierDescription: "Sells, licenses or integrates cryptography for other organizations.",
      classifierThresholdPercent: 99,
      isDefault: vendor.isDefault,
      freeRequiresWorkEmail: vendor.freeRequiresWorkEmail,
      active: vendor.active,
    });
    const third = await register(event, "three@vendor-example.test");
    expect(third.ticket).toMatchObject({ ticketName: "Vendor" });
  });

  it("asks no model and keeps no decision for a person without an organization or work address", async () => {
    const { event } = await seedTickets();
    const { types } = await readEventTicketSnapshot(env.DB, event);
    const run = vi.fn(async () => ({ answers: { ticket: { probabilities: { pqcc_vendor: 0.99 } } } }));
    const decided = await decideOrganizationTicket(env.DB, { AI: { run } } as never, types, {
      organizationId: null,
      organizationName: null,
      domains: [],
    });
    expect(decided).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ticket_organization_decisions").first("n")).toBe(0);
  });

  it("keeps decisions when ticket descriptions are added or cleared", async () => {
    const { event, admin } = await seedTickets();
    await register(event, "one@vendor-example.test", classifier({ pqcc_vendor: 0.97, pqcc_attendee: 0.03 }));
    // Another organization has two decisions among these tickets: the organizer's counts over the classifier's.
    const organizationId = await organizationFor("kept-example.test");
    await env.DB.batch([
      prepareStoreTicketDecision(env.DB, {
        organizationId,
        ticketKey: "pqcc_attendee",
        source: "classifier",
        confidence: 0.8,
        model: "synthetic",
      }),
      prepareStoreTicketDecision(env.DB, {
        organizationId,
        ticketKey: "pqcc_vendor",
        source: "organizer",
        confidence: null,
        model: null,
      }),
    ]);
    const configuration = await readEventTicketsConfiguration(env.DB, event);
    await saveEventTicketType(env.DB, admin, event, null, {
      expectedRevision: configuration.revision,
      key: "pqcc_academic",
      name: "Academic",
      descriptionMarkdown: "",
      classifierDescription: "A university or research institute.",
      classifierThresholdPercent: 75,
      isDefault: false,
      freeRequiresWorkEmail: false,
      active: true,
    });
    // No classifier: both decisions are still found among the new set of tickets.
    expect((await register(event, "two@vendor-example.test")).ticket).toMatchObject({ ticketName: "Vendor" });
    expect((await register(event, "two@kept-example.test")).ticket).toMatchObject({ ticketName: "Vendor" });
    const counts = (await readEventTicketsConfiguration(env.DB, event)).types.map((type) => [
      type.key,
      type.presetOrganizations,
    ]);
    expect(Object.fromEntries(counts)).toEqual({ pqcc_attendee: 0, pqcc_vendor: 2, pqcc_academic: 0 });

    // Only the vendor ticket keeps a description: its decisions still apply, though the model is no longer asked.
    const clearDescription = async (key: string) => {
      const current = await readEventTicketsConfiguration(env.DB, event);
      const type = current.types.find((candidate) => candidate.key === key)!;
      await saveEventTicketType(env.DB, admin, event, type.id, {
        expectedRevision: current.revision,
        key: type.key,
        name: type.name,
        descriptionMarkdown: type.descriptionMarkdown,
        classifierDescription: "",
        classifierThresholdPercent: type.classifierThresholdPercent,
        isDefault: type.isDefault,
        freeRequiresWorkEmail: type.freeRequiresWorkEmail,
        active: type.active,
      });
    };
    await clearDescription("pqcc_attendee");
    await clearDescription("pqcc_academic");
    expect((await register(event, "three@vendor-example.test")).ticket).toMatchObject({ ticketName: "Vendor" });

    // No ticket keeps a description: a decision made stays made, the classifier's as well as an organizer's.
    await clearDescription("pqcc_vendor");
    expect((await register(event, "four@vendor-example.test")).ticket).toMatchObject({ ticketName: "Vendor" });
    expect((await register(event, "three@kept-example.test")).ticket).toMatchObject({ ticketName: "Vendor" });
    const remaining = (await readEventTicketsConfiguration(env.DB, event)).types.map((type) => [
      type.key,
      type.presetOrganizations,
    ]);
    expect(Object.fromEntries(remaining)).toEqual({ pqcc_attendee: 0, pqcc_vendor: 2, pqcc_academic: 0 });
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
                (SELECT COUNT(*) FROM ticket_organization_decisions WHERE source = 'organizer') AS decisions`,
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
    // Two people hold the same quote for a code's last pass: the second plan is refused whole by its own
    // guard, the count stays within the limit, and the refusal is recognized as the code being used up.
    const last = await createEventTicketCode(env.DB, admin, event, {
      ticketTypeId: vendor.id,
      label: "Last pass",
      discount: "amount",
      amount: 0,
      maxUses: 1,
    });
    const plan = async (email: string) => {
      const person = await findOrCreateUser(env.DB, { email, firstName: "A", lastName: "B" });
      await quoteEventTicket(
        env.DB,
        {},
        event,
        { userId: person.id, email },
        { dayAttendance: inPerson, code: last.code, save: true },
      );
      const { registration } = await createScheduledRegistration(env.DB, {
        event: { id: event.id },
        userId: person.id,
        sourceType: "direct",
        verifiedIdentity: { userId: person.id },
      });
      return (await planRegistrationTicket(
        env.DB,
        {},
        {
          event,
          registrationId: registration.id,
          userId: person.id,
          email,
          identityId: null,
          dayAttendance: inPerson,
        },
      ))!;
    };
    const [one, two] = [await plan("one@sponsor-example.test"), await plan("two@sponsor-example.test")];
    await env.DB.batch(one.statements);
    expect(await isTicketCodeSpent(env.DB, two.claimedCodeId)).toBe(true);
    await expect(env.DB.batch(two.statements)).rejects.toBeTruthy();
    expect(
      await env.DB.prepare("SELECT used_count, max_uses FROM event_ticket_codes WHERE id = ?").bind(last.id).first(),
    ).toEqual({
      used_count: 1,
      max_uses: 1,
    });
  });

  it("does not open another checkout when payment starts before the attempt is saved", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "checkout-race@gmail.com");
    const ticket = (await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id }))!;
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `INSERT INTO registration_ticket_payment_events (provider_event_id, ticket_id, event_type, outcome, created_at)
         VALUES (?, ?, 'checkout.session.completed', 'processing', ?)`,
      )
        .bind(`evt_checkout_${crypto.randomUUID()}`, ticket.id, nowIso())
        .run(),
    );

    await expect(
      openTicketCheckout(
        racedDb,
        paymentEnv,
        "https://example.test",
        { eventId: event.id, registrationId: registration.id, userId: user.id },
        stripe,
      ),
    ).rejects.toMatchObject({ code: "TICKET_NOT_PAYABLE" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM registration_ticket_checkouts WHERE ticket_id = ?")
        .bind(ticket.id)
        .first(),
    ).toEqual({ n: 0 });
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
        unpaidHoldDays: configuration.settings.unpaidHoldDays,
        paymentRetryDays: configuration.settings.paymentRetryDays,
        transferable: configuration.settings.transferable,
        sendInvoice: configuration.settings.sendInvoice,
        refundDaysBeforeEvent: null,
        refundFee: 0,
      }),
    ).rejects.toMatchObject({ code: "TICKET_CURRENCY_FIXED" });
  });

  it("suspends admission for a disputed payment without refunding a repeat checkout event", async () => {
    const { event, admin } = await seedTickets();
    const { registration, user } = await register(event, "disputed-payment@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
    await paidEvent(ticketId, "cs_test_ticket", 19500);
    const dispute = (id: string, type: string, status: string, created?: number) =>
      handleEventTicketStripeEvent(env.DB, {
        id,
        type,
        ...(created === undefined ? {} : { created }),
        data: { object: { id: "dp_synthetic", payment_intent: "pi_synthetic", status } },
      });
    expect(await dispute("evt_dispute_created", "charge.dispute.created", "needs_response")).toMatchObject({
      outcome: "handling_required",
    });
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("payment_under_review");
    const badge = await env.DB.prepare(
      `SELECT ${badgeAttendeeEligibilitySql("registration", "person")} AS eligible
       FROM registrations registration JOIN users person ON person.id = registration.user_id
       WHERE registration.id = ?`,
    )
      .bind(registration.id)
      .first<{ eligible: number }>();
    expect(badge?.eligible).toBe(0);
    const issued = await listIssuedTickets(
      env.DB,
      event,
      issuedTicketsQuerySchema.parse({ payment: "payment_under_review" }),
    );
    expect(issued).toMatchObject({
      page: { total: 1 },
      summary: { byPayment: { payment_under_review: 1 }, collected: 0, underReviewAmount: 19500 },
    });
    const configuration = await readEventTicketsConfiguration(env.DB, event);
    expect(configuration.totals).toMatchObject({ underReviewCount: 1, underReviewAmount: 19500 });
    await expect(
      planRegistrationTicket(
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
      ),
    ).rejects.toMatchObject({ code: "TICKET_PAYMENT_UNDER_REVIEW" });
    const record = await getRegistrationByIdForEvent(env.DB, event.id, registration.id);
    await expect(
      buildRegistrationUpdate(env.DB, record, {
        action: "update",
        dayAttendance: [{ dayDate: DAY, attendanceType: "virtual" }],
      }),
    ).rejects.toMatchObject({ code: "TICKET_PAYMENT_UNDER_REVIEW" });
    await env.DB.prepare("UPDATE registration_tickets SET dispute_reason = 'Synthetic review' WHERE id = ?")
      .bind(ticketId)
      .run();
    await expect(
      reviewDisputedTicket(env.DB, admin, event, registration.id, "move", "https://example.test"),
    ).rejects.toMatchObject({ code: "TICKET_PAYMENT_UNDER_REVIEW" });
    expect(await paidEvent(ticketId, "cs_test_ticket", 19500, "evt_repeat_paid_after_dispute")).toMatchObject({
      outcome: "already_paid",
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM registration_ticket_refunds WHERE ticket_id = ?")
        .bind(ticketId)
        .first(),
    ).toEqual({ count: 0 });
    expect(await dispute("evt_dispute_won", "charge.dispute.closed", "won", 2_000)).toMatchObject({
      outcome: "dispute_kept",
    });
    // The payment stayed, so the ticket admits again.
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("paid");
    expect(
      await env.DB.prepare(
        "SELECT status FROM payment_ledger_entries WHERE provider_payment_intent_id = 'pi_synthetic'",
      ).first(),
    ).toEqual({ status: "paid" });
    // The dispute's opening arriving again after its close reopens nothing.
    expect(await dispute("evt_dispute_created_late", "charge.dispute.created", "needs_response", 1_000)).toMatchObject({
      outcome: "handling_required",
    });
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("paid");
    expect(
      await env.DB.prepare(
        `SELECT ${badgeAttendeeEligibilitySql("registration", "person")} AS eligible
       FROM registrations registration JOIN users person ON person.id = registration.user_id
       WHERE registration.id = ?`,
      )
        .bind(registration.id)
        .first(),
    ).toEqual({ eligible: 1 });
  });

  it.each([false, true])(
    "keeps an early dispute as payment evidence before Checkout maps the intent (declared event: %s)",
    async (declaredEvent) => {
      const { event } = await seedTickets();
      const { registration, user } = await register(event, `early-dispute-${declaredEvent}@gmail.com`);
      const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
      await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
      const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
      const disputedAt = Math.floor(Date.now() / 1000);
      const dispute = {
        id: `evt_early_dispute_${declaredEvent}`,
        created: disputedAt,
        type: "charge.dispute.created",
        data: {
          object: {
            id: "dp_early_synthetic",
            payment_intent: "pi_synthetic",
            status: "needs_response",
            ...(declaredEvent ? { metadata: { pkic_payment_type: "event" } } : {}),
          },
        },
      };
      await dispatchStripePaymentEvent(env.DB, paymentEnv, dispute, "https://example.test", () => undefined);
      expect(
        await env.DB.prepare(
          `SELECT ledger.status, evidence.event_type FROM payment_ledger_entries ledger
           JOIN payment_ledger_events evidence ON evidence.payment_id = ledger.id
           WHERE ledger.provider_payment_intent_id = 'pi_synthetic'`,
        ).first(),
      ).toMatchObject({ status: "disputed", event_type: "charge.dispute.created" });

      const completed = await dispatchStripePaymentEvent(
        env.DB,
        paymentEnv,
        {
          id: `evt_checkout_after_dispute_${declaredEvent}`,
          created: disputedAt,
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test_ticket",
              payment_intent: "pi_synthetic",
              amount_total: 19500,
              currency: "usd",
              payment_status: "paid",
              metadata: { pkic_payment_type: "event", registrationTicketId: ticketId },
            },
          },
        },
        "https://example.test",
        () => undefined,
      );
      expect(completed).toMatchObject({ outcome: "handling_required" });
      expect((await readRegistrationTicket(env.DB, input))!.status).toBe("payment_under_review");
      expect(
        await env.DB.prepare(
          "SELECT status FROM payment_ledger_entries WHERE provider_payment_intent_id = 'pi_synthetic'",
        ).first(),
      ).toEqual({ status: "disputed" });
      const eligible = await env.DB.prepare(
        `SELECT ${badgeAttendeeEligibilitySql("registration", "person")} AS admitted
         FROM registrations registration JOIN users person ON person.id = registration.user_id
         WHERE registration.id = ?`,
      )
        .bind(registration.id)
        .first<{ admitted: number }>();
      expect(eligible?.admitted).toBe(0);
      expect(
        await env.DB.prepare(
          "SELECT purpose, resource_type, resource_id FROM payment_ledger_entries WHERE provider_payment_intent_id = 'pi_synthetic'",
        ).first(),
      ).toMatchObject({ purpose: "event", resource_type: "registration_ticket", resource_id: ticketId });
    },
  );

  it.each([false, true])(
    "holds an early refund for review before Checkout maps the intent (declared event: %s)",
    async (declaredEvent) => {
      const { event } = await seedTickets();
      const { registration, user } = await register(event, `early-refund-${declaredEvent}@gmail.com`);
      const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
      await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
      const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
      const adjustedAt = Math.floor(Date.now() / 1000);
      await dispatchStripePaymentEvent(
        env.DB,
        paymentEnv,
        {
          id: `evt_early_refund_${declaredEvent}`,
          created: adjustedAt,
          type: "charge.refunded",
          data: {
            object: {
              id: "ch_early_refund",
              payment_intent: "pi_synthetic",
              refunded: false,
              amount_refunded: 500,
              ...(declaredEvent ? { metadata: { pkic_payment_type: "event" } } : {}),
            },
          },
        },
        "https://example.test",
        () => undefined,
      );
      expect(
        await env.DB.prepare(
          "SELECT status FROM payment_ledger_entries WHERE provider_payment_intent_id = 'pi_synthetic'",
        ).first(),
      ).toEqual({ status: "refunded" });
      const settled = await handleEventTicketStripeEvent(env.DB, {
        id: `evt_checkout_after_refund_${declaredEvent}`,
        created: adjustedAt,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_ticket",
            payment_intent: "pi_synthetic",
            amount_total: 19500,
            currency: "usd",
            payment_status: "paid",
            metadata: { pkic_payment_type: "event", registrationTicketId: ticketId },
          },
        },
      });
      expect(settled).toMatchObject({ outcome: "handling_required" });
      expect((await readRegistrationTicket(env.DB, input))!.status).toBe("payment_under_review");
      expect(
        await env.DB.prepare(
          "SELECT status FROM payment_ledger_entries WHERE provider_payment_intent_id = 'pi_synthetic'",
        ).first(),
      ).toEqual({ status: "refunded" });
    },
  );

  it("retries checkout settlement as disputed when a dispute arrives before its write batch", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "racing-dispute@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
    const dispute = {
      id: "evt_racing_dispute",
      created: Math.floor(Date.now() / 1000),
      type: "charge.dispute.created",
      data: { object: { id: "dp_racing", payment_intent: "pi_synthetic", status: "needs_response" } },
    };
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      dispatchStripePaymentEvent(env.DB, paymentEnv, dispute, "https://example.test", () => undefined),
    );
    const settled = await handleEventTicketStripeEvent(racedDb, {
      id: "evt_checkout_racing_dispute",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_ticket",
          payment_intent: "pi_synthetic",
          amount_total: 19500,
          currency: "usd",
          payment_status: "paid",
          metadata: { pkic_payment_type: "event", registrationTicketId: ticketId },
        },
      },
    });
    expect(settled).toMatchObject({ outcome: "handling_required" });
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("payment_under_review");
  });

  it("holds a refund received after Checkout maps an unsettled intent", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "mapped-early-refund@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
    await env.DB.prepare(
      "UPDATE registration_ticket_checkouts SET payment_intent_id = 'pi_synthetic' WHERE provider_session_id = 'cs_test_ticket'",
    ).run();
    const adjustment = await dispatchStripePaymentEvent(
      env.DB,
      paymentEnv,
      {
        id: "evt_mapped_early_refund",
        created: Math.floor(Date.now() / 1000),
        type: "charge.refunded",
        data: { object: { id: "ch_mapped_refund", payment_intent: "pi_synthetic", amount_refunded: 500 } },
      },
      "https://example.test",
      () => undefined,
    );
    expect(adjustment).toMatchObject({ outcome: "handling_required" });
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("pending_payment");
    expect(await paidEvent(ticketId, "cs_test_ticket", 19500)).toMatchObject({ outcome: "handling_required" });
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("payment_under_review");
  });

  it("ends the payment review when the provider keeps the payment or returns all of it", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "review-ends@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
    await paidEvent(ticketId, "cs_test_ticket", 19500);
    const send = (id: string, type: string, object: Record<string, unknown>, created: number) =>
      handleEventTicketStripeEvent(env.DB, {
        id,
        type,
        created,
        data: { object: { payment_intent: "pi_synthetic", ...object } },
      });
    const status = async () => (await readRegistrationTicket(env.DB, input))!.status;

    // An inquiry closed without a chargeback keeps the payment, so the ticket admits again.
    await send(
      "evt_inquiry_opened",
      "charge.dispute.created",
      { id: "dp_inquiry", status: "warning_needs_response" },
      1_000,
    );
    expect(await status()).toBe("payment_under_review");
    await send("evt_inquiry_closed", "charge.dispute.closed", { id: "dp_inquiry", status: "warning_closed" }, 2_000);
    expect(await status()).toBe("paid");

    // All of a payment under review refunded at the provider: the ticket is refunded, not held for review.
    await env.DB.prepare("UPDATE registration_tickets SET status = 'payment_under_review' WHERE id = ?")
      .bind(ticketId)
      .run();
    await send(
      "evt_full_refund",
      "charge.refunded",
      { id: "ch_synthetic", amount_refunded: 19500, refunded: true },
      3_000,
    );
    expect(await status()).toBe("refunded");
  });

  it("does not hold a ticket for review over a refund it already applied", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "moved-to-free-days@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
    await paidEvent(ticketId, "cs_test_ticket", 19500);
    // The holder moved to days that cost nothing, so all of the payment goes back and the ticket still stands.
    await env.DB.prepare("UPDATE registration_tickets SET amount = 0 WHERE id = ?").bind(ticketId).run();
    await handleEventTicketStripeEvent(env.DB, {
      id: "evt_all_back_for_free_days",
      type: "charge.refunded",
      created: 1_000,
      data: { object: { id: "ch_synthetic", payment_intent: "pi_synthetic", amount_refunded: 19500, refunded: true } },
    });
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("paid");
    expect(
      await env.DB.prepare(`SELECT ${ticketPaymentDisputedSql("?")} AS disputed`)
        .bind(registration.id)
        .first(),
    ).toEqual({ disputed: 0 });
  });

  it("converges the ticket to disputed when fallback evidence records just after settlement", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "late-ledger-dispute@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
    const disputedAt = Math.floor(Date.now() / 1000);
    const dispute = {
      id: "evt_late_ledger_dispute",
      created: disputedAt,
      type: "charge.dispute.created",
      data: { object: { id: "dp_late_ledger", payment_intent: "pi_synthetic", status: "needs_response" } },
    };
    const racedDb = mutateBeforeNextBatch(env.DB, () => paidEvent(ticketId, "cs_test_ticket", 19500));
    await dispatchStripePaymentEvent(racedDb, paymentEnv, dispute, "https://example.test", () => undefined);
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("payment_under_review");
    expect(
      await env.DB.prepare(
        `SELECT ${badgeAttendeeEligibilitySql("registration", "person")} AS admitted
       FROM registrations registration JOIN users person ON person.id = registration.user_id
       WHERE registration.id = ?`,
      )
        .bind(registration.id)
        .first(),
    ).toEqual({ admitted: 0 });
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

  it.each(["succeeded", "failed"] as const)(
    "links a %s refund webhook that arrives before the create response is stored",
    async (status) => {
      const { event, admin } = await seedTickets();
      const { registration, user } = await register(event, `early-refund-${status}@gmail.com`);
      const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
      await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
      const ticketId = (await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id }))!
        .id;
      await paidEvent(ticketId, "cs_test_ticket", 19500);
      await requestTicketRefund(env.DB, admin, { ...input, reason: "Refund requested" });
      const refund = await env.DB.prepare("SELECT id FROM registration_ticket_refunds WHERE ticket_id = ?")
        .bind(ticketId)
        .first<{ id: string }>();
      const fetcher = (async () => {
        expect(
          await handleEventTicketStripeEvent(env.DB, {
            id: `evt_early_refund_${status}`,
            type: "refund.updated",
            data: {
              object: {
                id: `re_early_${status}`,
                payment_intent: "pi_synthetic",
                amount: 19500,
                status,
                metadata: { registrationTicketId: ticketId, registrationTicketRefundId: refund!.id },
              },
            },
          }),
        ).toMatchObject({ outcome: status === "succeeded" ? "refund_confirmed" : "refund_failed" });
        return new Response(JSON.stringify({ id: `re_early_${status}`, status: "pending" }), { status: 200 });
      }) as unknown as typeof fetch;
      expect(await processTicketRefunds(env.DB, paymentEnv, 5, fetcher)).toEqual({ processed: 1, failed: 0 });
      const rows = await env.DB.prepare(
        "SELECT id, provider_refund_id, completed_at, failed_at FROM registration_ticket_refunds WHERE ticket_id = ?",
      )
        .bind(ticketId)
        .all<{ id: string; provider_refund_id: string; completed_at: string | null; failed_at: string | null }>();
      expect(rows.results).toHaveLength(1);
      expect(rows.results[0]).toMatchObject({ id: refund!.id, provider_refund_id: `re_early_${status}` });
      expect(Boolean(rows.results[0].completed_at)).toBe(status === "succeeded");
      expect(Boolean(rows.results[0].failed_at)).toBe(status === "failed");
    },
  );

  it("lets an organizer refund again after the provider fails or refuses a refund", async () => {
    const { event, admin } = await seedTickets();
    const { registration, user } = await register(event, "refund-failed@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
    await paidEvent((await read())!.id, "cs_test_ticket", 19500);
    const answer = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

    // One of the ticket's refunds fails between the organizer's read and the write: the request is refused whole,
    // with no refund and no audit entry, and goes through once the ticket is settled again.
    const ticketId = (await read())!.id;
    const raced = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.prepare("UPDATE registration_tickets SET refund_reconcile_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), ticketId)
          .run();
        return env.DB.batch(statements);
      },
    } as unknown as typeof env.DB;
    await expect(requestTicketRefund(raced, admin, { ...input, reason: "Visa refused" })).rejects.toMatchObject({
      code: "TICKET_REFUND_PENDING",
    });
    const written = () =>
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM registration_ticket_refunds) AS refunds,
                (SELECT COUNT(*) FROM audit_log WHERE action = 'registration_ticket_refund_requested') AS audits`,
      ).first();
    expect(await written()).toEqual({ refunds: 0, audits: 0 });
    await env.DB.prepare("UPDATE registration_tickets SET refund_reconcile_at = NULL WHERE id = ?")
      .bind(ticketId)
      .run();

    // The provider confirms the refund at once, then fails it: the ticket is paid again and can be refunded again.
    await requestTicketRefund(env.DB, admin, { ...input, reason: "Visa refused" });
    expect(await written()).toEqual({ refunds: 1, audits: 1 });
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
    // Nothing is worked out from the failure: the ticket waits until the provider is asked what was returned.
    expect(await read()).toMatchObject({ status: "refunded", refundPending: true });
    await expect(requestTicketRefund(env.DB, admin, { ...input, reason: "Too soon" })).rejects.toMatchObject({
      code: "TICKET_REFUND_PENDING",
    });
    const asked: string[] = [];
    const total = (amountRefunded: number, refunded = false) =>
      (async (url: string) => {
        asked.push(url);
        return new Response(JSON.stringify({ latest_charge: { amount_refunded: amountRefunded, refunded } }), {
          status: 200,
        });
      }) as unknown as typeof fetch;
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, answer(500, {}))).toEqual({ reconciled: 0, failed: 1 });
    // A write that fails part way writes nothing: the ticket stays marked and is read again on the next run.
    const breaking = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: (statements: D1PreparedStatement[]) =>
        env.DB.batch([...statements, env.DB.prepare("INSERT INTO registration_ticket_refunds (id) VALUES (NULL)")]),
    } as unknown as typeof env.DB;
    expect(await reconcileTicketRefunds(breaking, paymentEnv, 5, total(0))).toEqual({ reconciled: 0, failed: 1 });
    expect(await read()).toMatchObject({ status: "refunded", refundedAmount: 19500, refundPending: true });
    expect(await read()).toMatchObject({ status: "refunded", refundPending: true });
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(0))).toEqual({ reconciled: 1, failed: 0 });
    expect(asked[0]).toContain("/v1/payment_intents/pi_synthetic?expand%5B%5D=latest_charge");
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(0))).toEqual({ reconciled: 0, failed: 0 });
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

  it.each(["refused", "failed_after_success", "failed_before_response"] as const)(
    "releases a policy fee when its refund is %s",
    async (outcome) => {
      const { event, admin } = await seedTickets();
      await env.DB.prepare("UPDATE events SET starts_at = ? WHERE id = ?")
        .bind(new Date(Date.now() + 30 * 86_400_000).toISOString(), event.id)
        .run();
      const configuration = await readEventTicketsConfiguration(env.DB, event);
      await updateEventTicketSettings(env.DB, admin, event, {
        expectedRevision: configuration.revision,
        ...configuration.settings,
        refundDaysBeforeEvent: 7,
        refundFee: 1000,
      });
      const { registration, user } = await register(event, `policy-failure-${outcome}@gmail.com`);
      const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
      await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
      const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
      const ticketId = (await read())!.id;
      await paidEvent(ticketId, "cs_test_ticket", 19500);
      const change = async (dayAttendance: typeof inPerson) => {
        const record = await getRegistrationByIdForEvent(env.DB, event.id, registration.id);
        await env.DB.batch(
          (await buildRegistrationUpdate(env.DB, record, { action: "update", dayAttendance })).statements,
        );
      };
      await change([{ dayDate: DAY, attendanceType: "virtual" }]);
      const fee = async () =>
        env.DB.prepare("SELECT kept_fee FROM registration_tickets WHERE id = ?")
          .bind(ticketId)
          .first<{ kept_fee: number }>();
      expect((await fee())!.kept_fee).toBe(1000);
      if (outcome === "refused") {
        await processTicketRefunds(
          env.DB,
          paymentEnv,
          5,
          (async () => new Response("{}", { status: 400 })) as typeof fetch,
        );
      } else {
        const refundId = (await env.DB.prepare("SELECT id FROM registration_ticket_refunds WHERE ticket_id = ?")
          .bind(ticketId)
          .first<{ id: string }>())!.id;
        const failedEvent = () =>
          handleEventTicketStripeEvent(env.DB, {
            id: `evt_policy_refund_failed_${outcome}`,
            type: "refund.failed",
            data: {
              object: {
                id: "re_policy_failed",
                payment_intent: "pi_synthetic",
                amount: 18500,
                status: "failed",
                metadata: { registrationTicketId: ticketId, registrationTicketRefundId: refundId },
              },
            },
          });
        await processTicketRefunds(env.DB, paymentEnv, 5, (async () => {
          if (outcome === "failed_before_response") await failedEvent();
          return new Response(
            JSON.stringify({
              id: "re_policy_failed",
              status: outcome === "failed_before_response" ? "failed" : "succeeded",
            }),
          );
        }) as typeof fetch);
        if (outcome === "failed_after_success") await failedEvent();
        await reconcileTicketRefunds(
          env.DB,
          paymentEnv,
          5,
          (async () =>
            new Response(JSON.stringify({ latest_charge: { amount_refunded: 0, refunded: false } }))) as typeof fetch,
        );
      }
      expect((await fee())!.kept_fee).toBe(0);
      expect(await read()).toMatchObject({ status: "paid", refundedAmount: 0, refundPending: false });
      await expect(change(inPerson)).resolves.toBeUndefined();
    },
  );

  it("keeps an accepted refund retryable after repeated database write failures", async () => {
    const { event, admin } = await seedTickets();
    const { registration, user } = await register(event, "refund-write-failure@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
    await paidEvent(ticketId, "cs_test_ticket", 19500);
    await requestTicketRefund(env.DB, admin, {
      eventId: event.id,
      registrationId: registration.id,
      reason: "Requested",
    });
    const refundId = (await env.DB.prepare("SELECT id FROM registration_ticket_refunds WHERE ticket_id = ?")
      .bind(ticketId)
      .first<{ id: string }>())!.id;
    const keys: string[] = [];
    let lookups = 0;
    const accepted = (async (_url: string, init: RequestInit) => {
      if (init.method === "GET") {
        lookups += 1;
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "re_accepted",
                status: "succeeded",
                amount: 19500,
                payment_intent: "pi_synthetic",
                metadata: { registrationTicketId: ticketId, registrationTicketRefundId: refundId },
              },
            ],
            has_more: false,
          }),
        );
      }
      keys.push(String(new Headers(init.headers).get("Idempotency-Key")));
      return new Response(JSON.stringify({ id: "re_accepted", status: "succeeded" }));
    }) as typeof fetch;
    let failPersistence = true;
    const flakyDb = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: (statements: D1PreparedStatement[]) => {
        if (failPersistence) {
          failPersistence = false;
          throw new Error("D1 write failed after Stripe accepted the refund");
        }
        return env.DB.batch(statements);
      },
    } as unknown as typeof env.DB;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      failPersistence = true;
      expect(await processTicketRefunds(flakyDb, paymentEnv, 5, accepted)).toEqual({ processed: 0, failed: 1 });
      const row = await env.DB.prepare(
        "SELECT id, attempts, provider_refund_id, failed_at FROM registration_ticket_refunds WHERE ticket_id = ?",
      )
        .bind(ticketId)
        .first<{ id: string; attempts: number; provider_refund_id: string | null; failed_at: string | null }>();
      expect(row).toMatchObject({ attempts: attempt + 1, provider_refund_id: null, failed_at: null });
      await env.DB.prepare("UPDATE registration_ticket_refunds SET next_attempt_at = ? WHERE id = ?")
        .bind(nowIso(), row!.id)
        .run();
    }
    expect(keys).toEqual([`registration-ticket-refund:${refundId}`]);
    expect(lookups).toBe(7);
    expect(await processTicketRefunds(env.DB, paymentEnv, 5, accepted)).toEqual({ processed: 1, failed: 0 });
    expect(lookups).toBe(8);
    expect(keys).toHaveLength(1);
    expect((await readRegistrationTicket(env.DB, input))!.status).toBe("refunded");
  });

  it.each(["wrong_amount", "incomplete_list", "expired_key"] as const)(
    "does not resend an uncertain refund when the provider lookup has a %s",
    async (caseName) => {
      const { event, admin } = await seedTickets();
      const { registration, user } = await register(event, `refund-lookup-${caseName}@gmail.com`);
      const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
      await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
      const ticketId = (await readRegistrationTicket(env.DB, input))!.id;
      await paidEvent(ticketId, "cs_test_ticket", 19500);
      await requestTicketRefund(env.DB, admin, {
        eventId: event.id,
        registrationId: registration.id,
        reason: "Requested",
      });
      const refundId = (await env.DB.prepare("SELECT id FROM registration_ticket_refunds WHERE ticket_id = ?")
        .bind(ticketId)
        .first<{ id: string }>())!.id;
      // A previous send may have reached Stripe, but our response or write was lost.
      await env.DB.prepare("UPDATE registration_ticket_refunds SET attempts = 1 WHERE id = ?").bind(refundId).run();
      if (caseName === "expired_key")
        await env.DB.prepare("UPDATE registration_ticket_refunds SET created_at = ? WHERE id = ?")
          .bind(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), refundId)
          .run();
      let posts = 0;
      const provider = (async (_url: string, init: RequestInit) => {
        if (init.method === "POST") posts += 1;
        return new Response(
          JSON.stringify(
            caseName === "incomplete_list"
              ? { data: [], has_more: true }
              : caseName === "expired_key"
                ? { data: [], has_more: false }
                : {
                    data: [
                      {
                        id: "re_wrong_amount",
                        status: "succeeded",
                        amount: 1,
                        payment_intent: "pi_synthetic",
                        metadata: { registrationTicketId: ticketId, registrationTicketRefundId: refundId },
                      },
                    ],
                    has_more: false,
                  },
          ),
        );
      }) as typeof fetch;
      expect(await processTicketRefunds(env.DB, paymentEnv, 5, provider)).toEqual({ processed: 0, failed: 1 });
      expect(posts).toBe(0);
      const row = await env.DB.prepare(
        "SELECT attempts, submitted_at, failed_at FROM registration_ticket_refunds WHERE id = ?",
      )
        .bind(refundId)
        .first();
      // Past the provider's idempotency window with no refund found, it was never sent: it fails where organizers see it.
      expect(row).toMatchObject({
        attempts: 2,
        submitted_at: null,
        failed_at: caseName === "expired_key" ? expect.any(String) : null,
      });
    },
  );

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

  it("applies refund totals in the provider's order and reads the total again after a failed refund", async () => {
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
    const failed = (id: string, created: number, refund: string, amount: number) =>
      handleEventTicketStripeEvent(env.DB, {
        id,
        type: "refund.failed",
        created,
        data: { object: { id: refund, payment_intent: "pi_synthetic", amount, status: "failed", created } },
      });
    const total = (amountRefunded: number, refunded = false) =>
      (async () =>
        new Response(JSON.stringify({ latest_charge: { amount_refunded: amountRefunded, refunded } }), {
          status: 200,
        })) as unknown as typeof fetch;
    // 2000 went back. A second refund of 1000, made in the same second as that total, fails. Whether the total
    // held it cannot be told from here, so nothing is taken off: the provider is asked, and it says 2000.
    await charge("evt_total_1", 1000, 2000);
    await failed("evt_failed_same_second", 1000, "re_same_second", 1000);
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000, refundPending: true });
    // A total from before the failure that arrives after it is left out.
    await charge("evt_total_late", 999, 19500, true);
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000 });
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(2000))).toEqual({ reconciled: 1, failed: 0 });
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000, refundPending: false });
    // A refund that had been counted in full and then fails: the provider's answer puts the ticket back to paid.
    await charge("evt_total_full", Math.floor(Date.now() / 1000) + 60, 19500, true);
    expect(await read()).toMatchObject({ status: "refunded", refundedAmount: 19500 });
    await failed("evt_failed_full", Math.floor(Date.now() / 1000) + 120, "re_rest", 17500);
    await failed("evt_failed_full_again", Math.floor(Date.now() / 1000) + 121, "re_rest", 17500);
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(2000))).toEqual({ reconciled: 1, failed: 0 });
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000, refundPending: false });

    // While the provider is still to be asked, the ticket is not replaced by registering again.
    await failed("evt_failed_replan", Math.floor(Date.now() / 1000) + 200, "re_replan", 500);
    await expect(
      planRegistrationTicket(
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
      ),
    ).rejects.toMatchObject({ code: "TICKET_REFUND_PENDING" });
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(2000))).toEqual({ reconciled: 1, failed: 0 });
    // Two runs overlap: the later one writes a partial total while the earlier one still waits for an answer
    // that says everything went back. The earlier answer is not written, and neither is anything that follows
    // from it: a refund still on its way stays open, so no second one can be asked for.
    await requestTicketRefund(env.DB, admin, { ...input, reason: "The rest" });
    const accepted = (async () =>
      new Response(JSON.stringify({ id: "re_open", status: "pending" }), { status: 200 })) as unknown as typeof fetch;
    expect(await processTicketRefunds(env.DB, paymentEnv, 5, accepted)).toEqual({ processed: 1, failed: 0 });
    const soon = Math.floor(Date.now() / 1000) + 220;
    await failed("evt_failed_overlap", soon, "re_overlap", 500);
    const overlapped = (async () => {
      expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(2000))).toEqual({ reconciled: 1, failed: 0 });
      return new Response(JSON.stringify({ latest_charge: { amount_refunded: 19500, refunded: true } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, overlapped)).toEqual({ reconciled: 0, failed: 0 });
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000, refundPending: true });
    expect(
      await env.DB.prepare(
        "SELECT completed_at FROM registration_ticket_refunds WHERE provider_refund_id = 're_open'",
      ).first(),
    ).toEqual({ completed_at: null });
    await expect(requestTicketRefund(env.DB, admin, { ...input, reason: "Again" })).rejects.toMatchObject({
      code: "TICKET_REFUND_PENDING",
    });
    // That refund then fails too, and the provider's answer settles the ticket again.
    await failed("evt_failed_open", soon + 10, "re_open", 17500);
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(2000))).toEqual({ reconciled: 1, failed: 0 });
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 2000, refundPending: false });
    // The provider's answer is delayed and a newer total arrives meanwhile: the stale answer is not written
    // over it, and the ticket is read again on the next run.
    const later = Math.floor(Date.now() / 1000) + 300;
    await failed("evt_failed_again", later, "re_other", 500);
    const delayed = (async () => {
      await charge("evt_total_during_read", later + 10, 3000);
      return new Response(JSON.stringify({ latest_charge: { amount_refunded: 2000, refunded: false } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, delayed)).toEqual({ reconciled: 0, failed: 0 });
    expect(await read()).toMatchObject({ refundedAmount: 3000, refundPending: true });
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(3000))).toEqual({ reconciled: 1, failed: 0 });
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 3000, refundPending: false });
    // The other order: a total from after the answer was asked for arrives once the answer is written, and applies.
    await charge("evt_total_after_read", later + 20, 4000);
    expect(await read()).toMatchObject({ refundedAmount: 4000, refundPending: false });
    // Two totals from the same second cannot be put in order: the second is not applied and the provider is asked.
    await charge("evt_total_same_second", later + 20, 6000);
    expect(await read()).toMatchObject({ refundedAmount: 4000, refundPending: true });
    expect(await reconcileTicketRefunds(env.DB, paymentEnv, 5, total(6000))).toEqual({ reconciled: 1, failed: 0 });
    expect(await read()).toMatchObject({ status: "paid", refundedAmount: 6000, refundPending: false });
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

  it("prices the ticket again when the days change, so a free start does not become a paid place", async () => {
    const { event } = await seedTickets();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO event_days (id, event_id, day_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), event.id, DAY, now, now)
      .run();
    const virtual = [{ dayDate: DAY, attendanceType: "virtual" }];
    const start = async (email: string) => {
      const user = await findOrCreateUser(env.DB, { email, firstName: "Synthetic", lastName: "Person" });
      const { registration } = await createScheduledRegistration(env.DB, {
        event: { id: event.id },
        userId: user.id,
        sourceType: "direct",
        verifiedIdentity: { userId: user.id },
        dayAttendance: virtual,
      });
      const ticket = await planRegistrationTicket(
        env.DB,
        {},
        {
          event,
          registrationId: registration.id,
          userId: user.id,
          email,
          identityId: null,
          dayAttendance: virtual,
        },
      );
      await env.DB.batch(ticket!.statements);
      const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
      const eligible = async () =>
        (await env.DB.prepare(
          `SELECT COUNT(*) AS total FROM registrations r JOIN users u ON u.id = r.user_id
           WHERE r.id = ? AND ${badgeAttendeeEligibilitySql("r", "u")}`,
        )
          .bind(registration.id)
          .first<{ total: number }>())!.total;
      const change = async (
        payload: Parameters<typeof buildRegistrationUpdate>[2],
        changedBy?: string,
      ): Promise<void> => {
        const record = await getRegistrationByIdForEvent(env.DB, event.id, registration.id);
        const built = await buildRegistrationUpdate(env.DB, record, payload, changedBy);
        await env.DB.batch(built.statements);
      };
      return { user, registration, read, eligible, change };
    };

    // Attending online costs nothing; moving to the venue afterwards is priced, and admits nobody until paid.
    const person = await start("days@gmail.com");
    expect(await person.read()).toMatchObject({ status: "free", amount: 0 });
    expect(await person.eligible()).toBe(1);
    await person.change({ action: "update", dayAttendance: inPerson });
    expect(await person.read()).toMatchObject({ status: "pending_payment", amount: 19500 });
    expect(await person.eligible()).toBe(0);
    // Back to what costs nothing, the ticket is free again.
    await person.change({ action: "update", dayAttendance: virtual });
    expect(await person.read()).toMatchObject({ status: "free", amount: 0 });
    expect(await person.eligible()).toBe(1);

    // A paid ticket covers what was paid for. Days that cost more are refused to the person, not to an organizer.
    await person.change({ action: "update", dayAttendance: inPerson });
    const input = { eventId: event.id, registrationId: person.registration.id, userId: person.user.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, stripe);
    await paidEvent((await person.read())!.id, "cs_test_ticket", 19500);
    // The event gives no refunds: moving to days that cost nothing returns nothing, and the ticket still
    // stands for what was paid, so the person can move back without paying again.
    await person.change({ action: "update", dayAttendance: virtual });
    expect(await person.read()).toMatchObject({ status: "paid", amount: 0, paidAmount: 19500, refundPending: false });
    expect(await person.eligible()).toBe(1);
    await person.change({ action: "update", dayAttendance: inPerson });
    expect(await person.read()).toMatchObject({ status: "paid", amount: 19500, paidAmount: 19500 });
    // Days that cost more than the payment covers are refused to the person, not to an organizer.
    await env.DB.prepare("UPDATE registration_tickets SET amount = 100, paid_amount = 100 WHERE registration_id = ?")
      .bind(person.registration.id)
      .run();
    await expect(person.change({ action: "update", dayAttendance: inPerson })).rejects.toMatchObject({
      code: "TICKET_CHANGE_COSTS_MORE",
    });
    await person.change({ action: "update", dayAttendance: inPerson }, "admin");
    expect(await person.read()).toMatchObject({ status: "paid", amount: 100 });

    // Canceling and restoring with other days does not keep the old price either.
    const other = await start("restore-days@gmail.com");
    await other.change({ action: "cancel" });
    expect(await other.read()).toMatchObject({ status: "canceled" });
    await other.change({ action: "update", dayAttendance: inPerson });
    expect(await other.read()).toMatchObject({ status: "pending_payment", amount: 19500 });
    expect(await other.eligible()).toBe(0);

    // A restore at the same price is asked for again: its reminders start over, and the write says what is owed.
    await other.change({ action: "cancel" });
    const reminders = () =>
      env.DB.prepare(
        "SELECT next_reminder_at, reminders_end_at, reminders_sent FROM registration_tickets WHERE registration_id = ?",
      )
        .bind(other.registration.id)
        .first<{ next_reminder_at: string | null; reminders_end_at: string | null; reminders_sent: number }>();
    expect(await reminders()).toMatchObject({ next_reminder_at: null });
    const record = await getRegistrationByIdForEvent(env.DB, event.id, other.registration.id);
    const restored = await buildRegistrationUpdate(env.DB, record, { action: "update" });
    expect(restored.paymentDue).toMatchObject({ amount: 19500 });
    await env.DB.batch(restored.statements);
    expect(await other.read()).toMatchObject({ status: "pending_payment", amount: 19500 });
    const restarted = await reminders();
    expect(restarted?.reminders_sent).toBe(0);
    expect(Date.parse(restarted!.next_reminder_at!)).toBeGreaterThan(Date.now());
    expect(Date.parse(restarted!.reminders_end_at!)).toBeGreaterThan(Date.parse(restarted!.next_reminder_at!));
  });

  it("refunds by the event's policy: the difference for cheaper days and the ticket on cancellation, within its period", async () => {
    const { event, admin } = await seedTickets();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO event_days (id, event_id, day_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), event.id, DAY, now, now)
      .run();
    const startsIn = (days: number) =>
      env.DB.prepare("UPDATE events SET starts_at = ? WHERE id = ?")
        .bind(new Date(Date.now() + days * 86_400_000).toISOString(), event.id)
        .run();
    const policy = async (refundDaysBeforeEvent: number | null, refundFee = 0) => {
      const configuration = await readEventTicketsConfiguration(env.DB, event);
      await updateEventTicketSettings(env.DB, admin, event, {
        expectedRevision: configuration.revision,
        currency: configuration.settings.currency,
        reminderIntervalDays: configuration.settings.reminderIntervalDays,
        reminderPeriodDays: configuration.settings.reminderPeriodDays,
        unpaidHoldDays: configuration.settings.unpaidHoldDays,
        paymentRetryDays: configuration.settings.paymentRetryDays,
        transferable: configuration.settings.transferable,
        sendInvoice: configuration.settings.sendInvoice,
        refundDaysBeforeEvent,
        refundFee,
      });
    };
    const virtual = [{ dayDate: DAY, attendanceType: "virtual" }];
    let session = 0;
    const paid = async (email: string) => {
      const { registration, user } = await register(event, email);
      const input = { eventId: event.id, registrationId: registration.id, userId: user.id };
      const sessionId = `cs_test_policy_${(session += 1)}`;
      const checkout = (async () =>
        new Response(JSON.stringify({ id: sessionId, url: `https://checkout.stripe.com/c/pay/${sessionId}` }), {
          status: 200,
        })) as unknown as typeof fetch;
      await openTicketCheckout(env.DB, paymentEnv, "https://example.test", input, checkout);
      const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
      const intent = `pi_policy_${session}`;
      await handleEventTicketStripeEvent(env.DB, {
        id: `evt_policy_paid_${session}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: sessionId,
            payment_intent: intent,
            amount_total: 19500,
            currency: "usd",
            payment_status: "paid",
            metadata: { pkic_payment_type: "event", registrationTicketId: (await read())!.id },
          },
        },
      });
      const change = async (payload: Parameters<typeof buildRegistrationUpdate>[2]): Promise<void> => {
        const record = await getRegistrationByIdForEvent(env.DB, event.id, registration.id);
        await env.DB.batch((await buildRegistrationUpdate(env.DB, record, payload)).statements);
      };
      const refunds = () =>
        env.DB.prepare(
          "SELECT amount, reason, payment_intent_id FROM registration_ticket_refunds WHERE ticket_id = (SELECT id FROM registration_tickets WHERE registration_id = ?)",
        )
          .bind(registration.id)
          .all<{ amount: number; reason: string; payment_intent_id: string }>();
      return { read, change, refunds, intent };
    };
    const provider = (body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

    // Refunds until 7 days before the event, which starts in 30 days.
    await startsIn(30);
    await policy(7);
    const mover = await paid("mover@gmail.com");
    expect((await mover.read())!.refundableUntil).not.toBeNull();
    await mover.change({ action: "update", dayAttendance: virtual });
    expect((await mover.refunds()).results).toEqual([
      { amount: 19500, reason: "Changed to days that cost less", payment_intent_id: mover.intent },
    ]);
    // The ticket costs nothing now and still stands; the money goes back and the person keeps their place.
    expect(await mover.read()).toMatchObject({ status: "paid", amount: 0, paidAmount: 19500, refundPending: true });
    await processTicketRefunds(env.DB, paymentEnv, 5, provider({ id: "re_difference", status: "succeeded" }));
    expect(await mover.read()).toMatchObject({
      status: "paid",
      amount: 0,
      refundedAmount: 19500,
      refundPending: false,
    });
    // The provider reporting that all of the payment went back does not take the place away either.
    await handleEventTicketStripeEvent(env.DB, {
      id: "evt_policy_refunded",
      type: "charge.refunded",
      created: Math.floor(Date.now() / 1000) + 60,
      data: { object: { id: "ch_policy", payment_intent: mover.intent, refunded: true, amount_refunded: 19500 } },
    });
    expect(await mover.read()).toMatchObject({ status: "paid", amount: 0, refundedAmount: 19500 });

    // Canceling within the period returns the ticket.
    const leaver = await paid("leaver@gmail.com");
    await leaver.change({ action: "cancel" });
    expect((await leaver.refunds()).results).toMatchObject([
      { amount: 19500, reason: "Canceled within the refund period" },
    ]);
    await processTicketRefunds(env.DB, paymentEnv, 5, provider({ id: "re_cancel", status: "succeeded" }));
    expect(await leaver.read()).toMatchObject({ status: "refunded", refundedAmount: 19500 });

    // After the period nothing goes back, for cheaper days or for a cancellation.
    await startsIn(3);
    const late = await paid("late@gmail.com");
    expect(await late.read()).toMatchObject({ status: "paid" });
    await late.change({ action: "update", dayAttendance: virtual });
    await late.change({ action: "cancel" });
    expect((await late.refunds()).results).toEqual([]);
    expect(await late.read()).toMatchObject({ status: "paid", paidAmount: 19500, refundedAmount: 0 });

    // With an administration fee, each refund the policy gives is that much less.
    await startsIn(30);
    await policy(7, 1000);
    const charged = await paid("charged@gmail.com");
    expect(await charged.read()).toMatchObject({ refundFee: 1000 });
    await charged.change({ action: "cancel" });
    expect((await charged.refunds()).results).toMatchObject([{ amount: 18500 }]);
    // While the money is on its way back the registration is not restored on the old ticket.
    await expect(charged.change({ action: "update", dayAttendance: inPerson })).rejects.toMatchObject({
      code: "TICKET_REFUND_PENDING",
    });
    await processTicketRefunds(env.DB, paymentEnv, 5, provider({ id: "re_fee_cancel", status: "succeeded" }));
    await reconcileTicketRefunds(
      env.DB,
      paymentEnv,
      5,
      provider({ latest_charge: { amount_refunded: 18500, refunded: false } }),
    );
    // All but the fee went back: the ticket is refunded, and a restored registration pays again.
    expect(await charged.read()).toMatchObject({ status: "refunded", refundedAmount: 18500, refundPending: false });
    await charged.change({ action: "update", dayAttendance: inPerson });
    expect(await charged.read()).toMatchObject({ status: "pending_payment", amount: 19500, paidAmount: 0 });

    const cheaper = await paid("cheaper@gmail.com");
    await cheaper.change({ action: "update", dayAttendance: virtual });
    expect((await cheaper.refunds()).results).toMatchObject([{ amount: 18500 }]);
    await processTicketRefunds(env.DB, paymentEnv, 5, provider({ id: "re_fee_difference", status: "succeeded" }));
    await reconcileTicketRefunds(
      env.DB,
      paymentEnv,
      5,
      provider({ latest_charge: { amount_refunded: 18500, refunded: false } }),
    );
    // The ticket costs nothing and stands; the fee that stayed behind does not buy the venue back.
    expect(await cheaper.read()).toMatchObject({ status: "paid", amount: 0, refundedAmount: 18500 });
    await expect(cheaper.change({ action: "update", dayAttendance: inPerson })).rejects.toMatchObject({
      code: "TICKET_CHANGE_COSTS_MORE",
    });
    // A fee needs a period to apply in.
    expect(
      eventTicketSettingsUpdateSchema.safeParse({
        expectedRevision: 1,
        currency: "usd",
        reminderIntervalDays: 3,
        reminderPeriodDays: 14,
        refundDaysBeforeEvent: null,
        refundFee: 1000,
      }).success,
    ).toBe(false);

    // A ticket keeps the terms it was paid under: taking the policy away later does not take its refund away,
    // and a policy added later does not give one to a ticket paid without it.
    await policy(7);
    const kept = await paid("kept-terms@gmail.com");
    await policy(null);
    expect(await kept.read()).toMatchObject({ refundFee: 0 });
    expect((await kept.read())!.refundableUntil).not.toBeNull();
    await kept.change({ action: "cancel" });
    expect((await kept.refunds()).results).toMatchObject([{ amount: 19500 }]);
    const without = await paid("without-terms@gmail.com");
    await policy(7, 1000);
    expect((await without.read())!.refundableUntil).toBeNull();
    await without.change({ action: "cancel" });
    expect((await without.refunds()).results).toEqual([]);

    // With no policy nothing goes back either, however far away the event is.
    await startsIn(30);
    await policy(null);
    const none = await paid("none@gmail.com");
    expect((await none.read())!.refundableUntil).toBeNull();
    await none.change({ action: "cancel" });
    expect((await none.refunds()).results).toEqual([]);
  });

  it("reprices a paid ticket when its canceled registration is submitted again for cheaper days", async () => {
    const { event, admin } = await seedTickets();
    const configuration = await readEventTicketsConfiguration(env.DB, event);
    await updateEventTicketSettings(env.DB, admin, event, {
      expectedRevision: configuration.revision,
      ...configuration.settings,
      refundDaysBeforeEvent: 1,
      refundFee: 0,
    });
    const { registration, user } = await register(event, "restore-paid@gmail.com");
    const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
    await openTicketCheckout(
      env.DB,
      paymentEnv,
      "https://example.test",
      {
        eventId: event.id,
        registrationId: registration.id,
        userId: user.id,
      },
      stripe,
    );
    await paidEvent((await read())!.id, "cs_test_ticket", 19500);
    const record = await getRegistrationByIdForEvent(env.DB, event.id, registration.id);
    const canceled = await buildRegistrationUpdate(env.DB, record, { action: "cancel" }, "admin");
    await env.DB.batch(canceled.statements);
    expect(await read()).toMatchObject({ status: "paid", amount: 19500 });

    const replanned = await planRegistrationTicket(
      env.DB,
      {},
      {
        event,
        registrationId: registration.id,
        userId: user.id,
        email: user.email,
        identityId: null,
        dayAttendance: [{ dayDate: DAY, attendanceType: "virtual" }],
      },
    );
    expect(replanned).toMatchObject({ status: "paid", amount: 0 });
    await env.DB.batch(replanned!.statements);
    expect(await read()).toMatchObject({ status: "paid", amount: 0, refundPending: true });
    expect(
      await env.DB.prepare("SELECT amount FROM registration_ticket_refunds WHERE ticket_id = ?")
        .bind(replanned!.id)
        .first(),
    ).toEqual({ amount: 19500 });
  });

  it("gives each active sponsor its two codes from its tier and only ever raises their limits", async () => {
    const { event, admin, attendee, vendor } = await seedTickets();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO sponsorships (id, sponsor_type, non_member_name, event_id, tier, pipeline_stage, created_at, updated_at)
       VALUES (?, 'event', 'Example Sponsor', ?, 'Gold', 'active', ?, ?),
              (?, 'event', 'Pending Sponsor', ?, 'Gold', 'payment_pending', ?, ?)`,
    )
      .bind(crypto.randomUUID(), event.id, now, now, crypto.randomUUID(), event.id, now, now)
      .run();
    await expect(issueSponsorPassCodes(env.DB, admin, event)).rejects.toMatchObject({
      code: "SPONSOR_PASSES_UNAVAILABLE",
    });
    const save = async (staffPasses: number, customerPasses: number) =>
      saveSponsorPasses(env.DB, admin, event, {
        expectedRevision: (await readEventTicketsConfiguration(env.DB, event)).revision,
        staffTicketTypeId: vendor.id,
        customerTicketTypeId: attendee.id,
        tiers: [
          { tierName: "Gold", sponsorType: null, staffPasses, customerPasses, sponsors: 0, sponsorsWithCodes: 0 },
        ],
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
    expect(configuration.sponsorPasses.tiers.find((tier) => tier.tierName === "Gold")).toEqual({
      tierName: "Gold",
      sponsorType: "consortium",
      staffPasses: 2,
      customerPasses: 4,
      sponsors: 1,
      sponsorsWithCodes: 1,
    });
  });

  it("gives the consortium's current sponsors their codes for each event, besides the event's own", async () => {
    const { event, admin, attendee, vendor } = await seedTickets();
    const now = new Date().toISOString();
    const organizationId = crypto.randomUUID();
    const outsideId = crypto.randomUUID();
    const lapsedId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organizations (id, name, normalized_name, sponsor_tier, created_at, updated_at) VALUES (?, 'Member Sponsor', 'member sponsor', 'Gold', ?, ?)",
      ).bind(organizationId, now, now),
      env.DB.prepare(
        `INSERT INTO sponsorships (id, sponsor_type, non_member_name, tier, pipeline_stage, created_at, updated_at)
         VALUES (?, 'consortium', 'Outside Sponsor', 'Gold', 'active', ?, ?),
                (?, 'consortium', 'Lapsed Sponsor', 'Gold', 'lapsed', ?, ?)`,
      ).bind(outsideId, now, now, lapsedId, now, now),
      // An event sponsorship without a tier yet leaves the organization's consortium tier in force.
      env.DB.prepare(
        `INSERT INTO sponsorships (id, sponsor_type, organization_id, event_id, pipeline_stage, created_at, updated_at)
         VALUES (?, 'event', ?, ?, 'active', ?, ?)`,
      ).bind(crypto.randomUUID(), organizationId, event.id, now, now),
    ]);
    await saveSponsorPasses(env.DB, admin, event, {
      expectedRevision: (await readEventTicketsConfiguration(env.DB, event)).revision,
      staffTicketTypeId: vendor.id,
      customerTicketTypeId: attendee.id,
      tiers: [
        { tierName: "Gold", sponsorType: null, staffPasses: 2, customerPasses: 3, sponsors: 0, sponsorsWithCodes: 0 },
      ],
    });
    expect(await issueSponsorPassCodes(env.DB, admin, event)).toEqual({ created: 4, raised: 0 });
    expect(await issueSponsorPassCodes(env.DB, admin, event)).toEqual({ created: 0, raised: 0 });
    const gold = (await readEventTicketsConfiguration(env.DB, event)).sponsorPasses.tiers.find(
      (tier) => tier.tierName === "Gold",
    );
    expect(gold).toMatchObject({ sponsors: 2, sponsorsWithCodes: 2 });
    const member = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM event_ticket_codes WHERE event_id = ? AND organization_id = ? AND sponsorship_id IS NULL",
    )
      .bind(event.id, organizationId)
      .first<{ total: number }>();
    expect(member?.total).toBe(2);

    // A code made for a sponsor counts for that sponsor; a lapsed sponsor gets none.
    const sponsors = await listEventTicketSponsors(env.DB, event.id, eventTicketSponsorListQuerySchema.parse({}));
    expect(sponsors.sponsors.map((sponsor) => sponsor.name)).toEqual(["Member Sponsor", "Outside Sponsor"]);
    const discount = {
      ticketTypeId: attendee.id,
      label: "Member Sponsor: partners",
      discount: "percent" as const,
      percentOff: 50,
      maxUses: 20,
    };
    const sponsored = await createEventTicketCode(env.DB, admin, event, { ...discount, sponsorId: organizationId });
    expect(sponsored).toMatchObject({
      sponsor: { id: organizationId, name: "Member Sponsor" },
      registrations: 0,
      revenue: 0,
    });
    await expect(
      createEventTicketCode(env.DB, admin, event, { ...discount, sponsorId: lapsedId }),
    ).rejects.toMatchObject({ code: "EVENT_TICKETS_CHANGED" });
    // The refused code leaves no audit entry behind.
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'event_ticket_code_created'").first("n"),
    ).toBe(1);
    const outside = await createEventTicketCode(env.DB, admin, event, { ...discount, sponsorId: outsideId });
    expect(outside.sponsor).toEqual({ id: outsideId, name: "Outside Sponsor" });
    const ofMember = await listEventTicketCodes(
      env.DB,
      event.id,
      eventTicketCodeListQuerySchema.parse({ sponsorId: organizationId, sort: "-revenue" }),
    );
    expect(ofMember.page.total).toBe(3);
    expect(ofMember.codes.every((code) => code.sponsor?.id === organizationId)).toBe(true);
  });

  it("changes the registrants' guidance on its own, leaving the payment settings as they were", async () => {
    const { event, admin } = await seedTickets();
    const before = await readEventTicketsConfiguration(env.DB, event);
    await updateEventTicketGuidance(env.DB, admin, event, {
      expectedRevision: before.revision,
      ticketIntro: "Choose based on your organization.",
      attendanceIntro: "",
    });
    const after = await readEventTicketsConfiguration(env.DB, event);
    expect(after.settings).toEqual({
      ...before.settings,
      ticketIntro: "Choose based on your organization.",
      attendanceIntro: "",
    });
    // A draft copied before that change is refused instead of overwriting it.
    await expect(
      updateEventTicketGuidance(env.DB, admin, event, {
        expectedRevision: before.revision,
        ticketIntro: "",
        attendanceIntro: "",
      }),
    ).rejects.toBeTruthy();
  });

  it("does not disclose bearer ticket codes to an event reader", async () => {
    const { event, admin } = await seedTickets();
    const readerId = await insertUser(env.DB, "ticket-reader@example.test");
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, created_at)
       VALUES (?, ?, 'events:read', 'event', ?, ?)`,
    )
      .bind(crypto.randomUUID(), readerId, event.id, nowIso())
      .run();
    const readerToken = await createMemberSession(env.DB, readerId, `code-reader-${crypto.randomUUID()}`);
    const adminToken = await createAdminSession(env.DB, admin.id, `code-admin-${crypto.randomUUID()}`);
    const path = "/api/v1/events/pqc-2026/tickets/codes";
    const request = (token: string) => callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
    expect((await request(readerToken)).status).toBe(403);
    expect((await request(adminToken)).status).toBe(200);
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

  it("sends an invoice only for a registration on behalf of an organization", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "buyer@gmail.com");
    const organizationId = await insertOrganization(env.DB, "Invoice Works");
    const identityId = crypto.randomUUID();
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, source, invited_at, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'verified_domain', ?, ?, ?, ?)`,
      ).bind(identityId, user.id, organizationId, at, at, at, at),
      env.DB.prepare("UPDATE registrations SET registration_identity_id = ? WHERE id = ?").bind(
        identityId,
        registration.id,
      ),
    ]);
    let request: URLSearchParams | null = null;
    const capture = (async (_url: string, init: RequestInit) => {
      request = new URLSearchParams(String(init.body));
      return Response.json({ id: "cs_test_org", url: "https://checkout.stripe.com/c/pay/cs_test_org" });
    }) as typeof fetch;
    await openTicketCheckout(
      env.DB,
      paymentEnv,
      "https://example.test",
      { eventId: event.id, registrationId: registration.id, userId: user.id },
      capture,
    );
    expect(request!.get("invoice_creation[enabled]")).toBe("true");
    expect(request!.get("tax_id_collection[enabled]")).toBe("true");
    const offer = await readEventTicketOffer(
      env.DB,
      {},
      event,
      { userId: user.id, email: "buyer@gmail.com" },
      identityId,
    );
    expect(offer.sendInvoice).toBe(true);
    const individual = await env.DB.prepare("SELECT id FROM identities WHERE user_id = ? AND organization_id IS NULL")
      .bind(user.id)
      .first<{ id: string }>();
    const personal = await readEventTicketOffer(
      env.DB,
      {},
      event,
      { userId: user.id, email: "buyer@gmail.com" },
      individual!.id,
    );
    expect(personal.sendInvoice).toBe(false);
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
    // The payment page states the refund terms the ticket is paid under.
    expect(stripeRequest!.get("custom_text[submit][message]")).toBe("Tickets for this event are not refunded.");
    expect(stripeRequest!.get("metadata[pkic_payment_type]")).toBe("event");
    // Stripe carries our registration as its reference, and the buyer may add their own.
    expect(stripeRequest!.get("client_reference_id")).toBe(registration.id);
    expect(stripeRequest!.get("metadata[registrationId]")).toBe(registration.id);
    expect(stripeRequest!.get("custom_fields[0][optional]")).toBe("true");
    // An individual registration gets the provider's receipt, never an invoice.
    expect(stripeRequest!.get("invoice_creation[enabled]")).toBeNull();
    expect(stripeRequest!.get("tax_id_collection[enabled]")).toBeNull();
    expect(stripeRequest!.get("payment_intent_data[receipt_email]")).toBe("journey@gmail.com");
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
    // Local currencies stay on, so a buyer is offered the payment methods of their own country.
    expect(new URLSearchParams(calls[0].body).has("adaptive_pricing[enabled]")).toBe(false);
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
    // The request to pay is a stored template with the ticket's facts as its variables.
    const request = await env.DB.prepare(
      "SELECT template_key, payload_json FROM email_outbox WHERE template_key = 'ticket_payment_request'",
    ).first<{ template_key: string; payload_json: string }>();
    expect(JSON.parse(request!.payload_json)).toMatchObject({
      ticketName: "Vendor",
      ticketPrice: "$395.00",
      paymentUrl: "https://example.test/portal/#/events/pqc-2026/ticket",
      refundPolicy: "Tickets for this event are not refunded.",
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
      ticketKey: "pqcc_attendee",
      status: "free",
    });
    const held = await env.DB.prepare("SELECT send_after FROM email_outbox WHERE id = 'held-2'").first<{
      send_after: string;
    }>();
    expect(held!.send_after < "9999").toBe(true);
  });

  it("waits for a payment that takes days: no second payment, no reminders, and a failure asks again", async () => {
    const { event } = await seedTickets();
    const { registration, user } = await register(event, "slow@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id };
    let pages = 0;
    const provider = (async () => {
      const id = `cs_test_slow_${++pages}`;
      return new Response(JSON.stringify({ id, url: `https://checkout.stripe.com/c/pay/${id}` }), { status: 200 });
    }) as unknown as typeof fetch;
    const open = () =>
      openTicketCheckout(env.DB, paymentEnv, "https://example.test", { ...input, userId: user.id }, provider);
    await open();
    const read = () => readRegistrationTicket(env.DB, input);
    const ticketId = (await read())!.id;
    const session = (type: string, payment_status: string) =>
      handleEventTicketStripeEvent(env.DB, {
        id: `evt_${crypto.randomUUID()}`,
        type,
        data: {
          object: {
            id: `cs_test_slow_${pages}`,
            payment_intent: "pi_synthetic",
            amount_total: 19500,
            currency: "usd",
            payment_status,
            metadata: { pkic_payment_type: "event", registrationTicketId: ticketId },
          },
        },
      });
    const due = () =>
      env.DB.prepare("UPDATE registration_tickets SET next_reminder_at = ? WHERE id = ?")
        .bind(new Date(Date.now() - 1000).toISOString(), ticketId)
        .run();

    // The page was finished with a bank debit: the money is on its way, so nothing more is asked.
    await due();
    expect(await session("checkout.session.completed", "unpaid")).toMatchObject({ outcome: "processing" });
    expect(await read()).toMatchObject({ status: "pending_payment", paymentProcessing: true });
    await expect(open()).rejects.toMatchObject({ code: "TICKET_PAYMENT_PROCESSING" });
    expect(await sendTicketPaymentReminders(env.DB, "https://example.test")).toEqual({ reminded: 0 });

    // It failed after all: the person is asked again, on a new payment page.
    expect(await session("checkout.session.async_payment_failed", "unpaid")).toMatchObject({
      outcome: "payment_failed",
    });
    expect(await read()).toMatchObject({ status: "pending_payment", paymentProcessing: false });
    // The place is kept for the event's retry period, a day unless the event says otherwise, and the email says why.
    const retryBy = Date.parse((await read())!.payBy!);
    expect(retryBy - Date.now()).toBeGreaterThan(0.9 * 86_400_000);
    expect(retryBy - Date.now()).toBeLessThan(1.1 * 86_400_000);
    expect(await sendTicketPaymentReminders(env.DB, "https://example.test")).toEqual({ reminded: 1 });
    const failedEmail = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE idempotency_key LIKE 'ticket-reminder:%' ORDER BY created_at DESC LIMIT 1",
    ).first<{ payload_json: string }>();
    expect(JSON.parse(failedEmail!.payload_json)).toMatchObject({ paymentFailed: true, payBy: expect.any(String) });
    await expect(open()).resolves.toMatchObject({ checkoutUrl: expect.any(String) });

    // The next one arrives days later and settles the ticket.
    expect(await session("checkout.session.completed", "unpaid")).toMatchObject({ outcome: "processing" });
    expect(await session("checkout.session.async_payment_succeeded", "paid")).toMatchObject({ outcome: "paid" });
    expect(await read()).toMatchObject({ status: "paid", paymentProcessing: false });
  });

  it("releases a place that was not paid within the event's hold period, and keeps one being paid", async () => {
    const { event, admin } = await seedTickets();
    // Without a hold period an unpaid place has no deadline.
    const kept = await register(event, "kept@gmail.com");
    const read = (registrationId: string) => readRegistrationTicket(env.DB, { eventId: event.id, registrationId });
    expect((await read(kept.registration.id))!.payBy).toBeNull();

    const configuration = await readEventTicketsConfiguration(env.DB, event);
    await updateEventTicketSettings(env.DB, admin, event, {
      expectedRevision: configuration.revision,
      ...configuration.settings,
      unpaidHoldDays: 3,
    });
    const late = await register(event, "late@gmail.com");
    const slow = await register(event, "slow-hold@gmail.com");
    const deadline = Date.parse((await read(late.registration.id))!.payBy!);
    expect(deadline - Date.now()).toBeGreaterThan(2.9 * 86_400_000);
    expect(deadline - Date.now()).toBeLessThan(3.1 * 86_400_000);

    // Nothing is due yet.
    expect(await releaseUnpaidTickets(env.DB, "https://example.test")).toEqual({ released: 0, failed: 0 });

    // Both deadlines pass; the second person's payment is on its way.
    await env.DB.prepare("UPDATE registration_tickets SET pay_by = ? WHERE registration_id IN (?, ?)")
      .bind(new Date(Date.now() - 1000).toISOString(), late.registration.id, slow.registration.id)
      .run();
    const slowTicket = (await read(slow.registration.id))!;
    await env.DB.prepare(
      `INSERT INTO registration_ticket_payment_events (provider_event_id, ticket_id, event_type, outcome, created_at)
       VALUES ('evt_hold_processing', ?, 'checkout.session.completed', 'processing', ?)`,
    )
      .bind(slowTicket.id, new Date().toISOString())
      .run();
    expect(await releaseUnpaidTickets(env.DB, "https://example.test")).toEqual({ released: 1, failed: 0 });

    const status = async (registrationId: string) =>
      (await env.DB.prepare("SELECT status FROM registrations WHERE id = ?").bind(registrationId).first<{
        status: string;
      }>())!.status;
    expect(await status(late.registration.id)).toBe("cancelled");
    expect((await read(late.registration.id))!.status).toBe("canceled");
    expect(await status(slow.registration.id)).not.toBe("cancelled");
    expect(await status(kept.registration.id)).not.toBe("cancelled");
    // The person is told why, and the release is on record.
    const email = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_updated' ORDER BY created_at DESC LIMIT 1",
    ).first<{ payload_json: string }>();
    expect(JSON.parse(email!.payload_json)).toMatchObject({
      status: "cancelled",
      unpaidRelease: true,
      paymentDue: false,
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration_cancelled_unpaid'",
      ).first(),
    ).toEqual({ n: 1 });
    // A second run finds nothing more to release.
    expect(await releaseUnpaidTickets(env.DB, "https://example.test")).toEqual({ released: 0, failed: 0 });
  });

  it("keeps an overdue place when payment starts after the due read but before cancellation", async () => {
    const { event, admin } = await seedTickets();
    const configuration = await readEventTicketsConfiguration(env.DB, event);
    await updateEventTicketSettings(env.DB, admin, event, {
      expectedRevision: configuration.revision,
      ...configuration.settings,
      unpaidHoldDays: 3,
    });
    const pending = await register(event, "raced-hold@gmail.com");
    const ticket = (await readRegistrationTicket(env.DB, {
      eventId: event.id,
      registrationId: pending.registration.id,
    }))!;
    await env.DB.prepare("UPDATE registration_tickets SET pay_by = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), ticket.id)
      .run();

    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `INSERT INTO registration_ticket_payment_events (provider_event_id, ticket_id, event_type, outcome, created_at)
       VALUES (?, ?, 'checkout.session.completed', 'processing', ?)`,
      )
        .bind(`evt_raced_${crypto.randomUUID()}`, ticket.id, new Date().toISOString())
        .run(),
    );
    expect(await releaseUnpaidTickets(racedDb, "https://example.test")).toEqual({ released: 0, failed: 0 });
    expect(
      await env.DB.prepare("SELECT status FROM registrations WHERE id = ?").bind(pending.registration.id).first(),
    ).toEqual({ status: "registered" });
    expect(
      await readRegistrationTicket(env.DB, { eventId: event.id, registrationId: pending.registration.id }),
    ).toMatchObject({ status: "pending_payment", paymentProcessing: true });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration_cancelled_unpaid'",
      ).first(),
    ).toEqual({ n: 0 });
  });

  it("runs the scheduled ticket job on request: it reminds, and releases a place that was not paid in time", async () => {
    const { event, admin } = await seedTickets();
    const configuration = await readEventTicketsConfiguration(env.DB, event);
    await updateEventTicketSettings(env.DB, admin, event, {
      expectedRevision: configuration.revision,
      ...configuration.settings,
      unpaidHoldDays: 3,
    });
    const reminded = await register(event, "job-reminded@gmail.com");
    const overdue = await register(event, "job-overdue@gmail.com");
    const past = new Date(Date.now() - 1000).toISOString();
    await env.DB.prepare("UPDATE registration_tickets SET next_reminder_at = ? WHERE registration_id = ?")
      .bind(past, reminded.registration.id)
      .run();
    await env.DB.prepare(
      "UPDATE registration_tickets SET pay_by = ?, next_reminder_at = NULL WHERE registration_id = ?",
    )
      .bind(past, overdue.registration.id)
      .run();

    // An administrator starts the job by hand, as on a system where no schedule runs.
    const token = await createAdminSession(env.DB, admin.id, `job-${crypto.randomUUID()}`);
    const response = await callApi(env, "/api/v1/scheduler/jobs/event_ticket_payments/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      jobKey: "event_ticket_payments",
      status: "succeeded",
    });

    const sent = await env.DB.prepare(
      `SELECT template_key, recipient_email FROM email_outbox
       WHERE (template_key = 'ticket_payment_reminder' AND recipient_email = ?)
          OR (template_key = 'registration_updated' AND recipient_email = ?)
       ORDER BY template_key`,
    )
      .bind(reminded.user.email, overdue.user.email)
      .all<{ template_key: string; recipient_email: string }>();
    expect(sent.results).toEqual([
      { template_key: "registration_updated", recipient_email: overdue.user.email },
      { template_key: "ticket_payment_reminder", recipient_email: reminded.user.email },
    ]);
    const status = await env.DB.prepare("SELECT status FROM registrations WHERE id = ?")
      .bind(overdue.registration.id)
      .first<{ status: string }>();
    expect(status!.status).toBe("cancelled");
  });

  it("tells ticket holders that a ticket can go to another person when the event says so", async () => {
    const { event, admin } = await seedTickets();
    const { registration } = await register(event, "transfer@gmail.com");
    const read = () => readRegistrationTicket(env.DB, { eventId: event.id, registrationId: registration.id });
    expect((await read())!.transferable).toBe(false);

    const configuration = await readEventTicketsConfiguration(env.DB, event);
    await updateEventTicketSettings(env.DB, admin, event, {
      expectedRevision: configuration.revision,
      ...configuration.settings,
      transferable: true,
    });
    expect((await readEventTicketsConfiguration(env.DB, event)).settings.transferable).toBe(true);
    const ticket = (await read())!;
    expect(ticket.transferable).toBe(true);
    // No refunds and transferable: both are said, in the words every screen and email uses.
    expect(ticketRefundNote(ticket)).toBe(
      "Tickets for this event are not refunded. You can transfer your ticket to another person. Contact the organizers to arrange it.",
    );

    // The reminder email carries the same terms.
    await env.DB.prepare("UPDATE registration_tickets SET next_reminder_at = '2000-01-01T00:00:00.000Z'").run();
    await sendTicketPaymentReminders(env.DB, "https://example.test");
    const email = await env.DB.prepare(
      "SELECT payload_json FROM email_outbox WHERE idempotency_key LIKE 'ticket-reminder:%' LIMIT 1",
    ).first<{ payload_json: string }>();
    expect(JSON.parse(email!.payload_json).refundPolicy).toContain("You can transfer your ticket to another person.");
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

  it("does not queue a payment reminder when processing starts after the due read", async () => {
    const { event } = await seedTickets();
    const pending = await register(event, "processing-reminder@gmail.com");
    const ticket = (await readRegistrationTicket(env.DB, {
      eventId: event.id,
      registrationId: pending.registration.id,
    }))!;
    await env.DB.prepare("UPDATE registration_tickets SET next_reminder_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), ticket.id)
      .run();
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO registration_ticket_payment_events (provider_event_id, ticket_id, event_type, outcome, created_at)
         VALUES (?, ?, 'checkout.session.completed', 'processing', ?)`,
        ).bind(`evt_processing_${crypto.randomUUID()}`, ticket.id, nowIso()),
        env.DB.prepare("UPDATE registration_tickets SET next_reminder_at = NULL WHERE id = ?").bind(ticket.id),
      ]),
    );
    expect(await sendTicketPaymentReminders(racedDb, "https://example.test")).toEqual({ reminded: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM email_outbox WHERE idempotency_key LIKE 'ticket-reminder:%'",
      ).first(),
    ).toEqual({ n: 0 });
  });

  it("brings a ticket in line with the payment provider on request, when its events did not arrive", async () => {
    const { event, admin } = await seedTickets();
    const { registration, user } = await register(event, "sync@gmail.com");
    const input = { eventId: event.id, registrationId: registration.id };
    await openTicketCheckout(env.DB, paymentEnv, "https://example.test", { ...input, userId: user.id }, stripe);
    const read = () => readRegistrationTicket(env.DB, input);
    const ticketId = (await read())!.id;
    const asked: string[] = [];
    const provider = (held: { session?: object; refund?: object; charge?: object }) =>
      (async (url: string) => {
        const path = new URL(url).pathname;
        asked.push(path);
        const body = path.startsWith("/v1/checkout/sessions/")
          ? held.session
          : path.startsWith("/v1/refunds/")
            ? held.refund
            : { latest_charge: held.charge };
        return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
      }) as unknown as typeof fetch;
    const sync = (held: Parameters<typeof provider>[0]) =>
      syncRegistrationTicketWithProvider(env.DB, paymentEnv, admin, input, provider(held));

    const unset = { ...env, STRIPE_SECRET_KEY: "" } as Env;
    await expect(syncRegistrationTicketWithProvider(env.DB, unset, admin, input)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    // The payment page is still open: nothing changes, and no payment is asked about.
    const session = { id: "cs_test_ticket", status: "open", payment_status: "unpaid" };
    expect(await sync({ session })).toMatchObject({ changed: false });
    expect(asked).toEqual(["/v1/checkout/sessions/cs_test_ticket"]);
    expect(await read()).toMatchObject({ status: "pending_payment" });

    // The registrant's own check asks about the payment only, and says nothing has changed while it is open.
    const own = (held: Parameters<typeof provider>[0]) =>
      syncRegistrationTicketWithProvider(env.DB, paymentEnv, user, { ...input, paymentOnly: true }, provider(held));
    asked.length = 0;
    expect(await own({ session })).toMatchObject({ changed: false });
    expect(asked).toEqual(["/v1/checkout/sessions/cs_test_ticket"]);

    // It was paid and the event never arrived: the ticket is settled as the event would have settled it.
    const paid = {
      ...session,
      status: "complete",
      payment_status: "paid",
      payment_intent: "pi_synthetic",
      amount_total: 19500,
      currency: "usd",
      metadata: { pkic_payment_type: "event", registrationTicketId: ticketId },
    };
    const charge = { amount_refunded: 0, refunded: false };
    expect(await sync({ session: paid, charge })).toMatchObject({ changed: true });
    expect(await read()).toMatchObject({ status: "paid", paidAmount: 19500, refundedAmount: 0 });
    // The event arriving afterwards, and asking again, change nothing.
    expect(await paidEvent(ticketId, "cs_test_ticket", 19500)).toMatchObject({ outcome: "already_paid" });
    asked.length = 0;
    expect(await sync({ session: paid, charge })).toMatchObject({ changed: false });
    // The payment is read for what it returned, and for how it was paid while that is still unknown.
    expect(asked).toEqual(["/v1/payment_intents/pi_synthetic", "/v1/payment_intents/pi_synthetic"]);

    // A refund was sent and its confirmation never arrived.
    await requestTicketRefund(env.DB, admin, { ...input, reason: "Visa refused" });
    const pending = (async () =>
      new Response(JSON.stringify({ id: "re_sync", status: "pending" }), { status: 200 })) as unknown as typeof fetch;
    await processTicketRefunds(env.DB, paymentEnv, 5, pending);
    expect(await read()).toMatchObject({ status: "paid", refundPending: true });
    const refund = { id: "re_sync", status: "pending", payment_intent: "pi_synthetic", amount: 19500 };
    expect(await sync({ refund, charge })).toMatchObject({ changed: false });
    expect(await read()).toMatchObject({ status: "paid", refundPending: true });
    expect(
      await sync({ refund: { ...refund, status: "succeeded" }, charge: { amount_refunded: 19500, refunded: true } }),
    ).toMatchObject({ changed: true });
    expect(await read()).toMatchObject({ status: "refunded", refundedAmount: 19500, refundPending: false });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'registration_ticket_synced'").first(),
    ).toEqual({ n: 2 });

    // A settled ticket gives the registrant's own check nothing to ask the provider.
    asked.length = 0;
    expect(await own({})).toMatchObject({ changed: false });
    expect(asked).toEqual([]);

    // The registrant may ask about their own ticket and an organizer about anyone's; nobody else may.
    const path = `/api/v1/events/pqc-2026/registrations/${registration.id}/ticket/sync`;
    expect((await callApi(paymentEnv, path, { method: "POST", body: "{}" })).status).toBe(401);
    const signedIn = async (userId: string) => ({
      headers: {
        authorization: `Bearer ${await createMemberSession(env.DB, userId, `session-${crypto.randomUUID()}`)}`,
        "content-type": "application/json",
      },
    });
    const mine = await callApi(paymentEnv, path, { method: "POST", body: "{}", ...(await signedIn(user.id)) });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ success: true, changed: false });
    const other = await findOrCreateUser(env.DB, { email: "other-sync@gmail.com", firstName: "O", lastName: "T" });
    expect(
      (await callApi(paymentEnv, path, { method: "POST", body: "{}", ...(await signedIn(other.id)) })).status,
    ).toBe(403);
  });
  it("lists the tickets an event issued with their payments and totals, and updates a batch from the provider", async () => {
    const { event, admin } = await seedTickets();
    const paidOne = await register(event, "paid-list@gmail.com");
    const openOne = await register(event, "open-list@gmail.com");
    const ticketOf = async (registrationId: string) =>
      (await readRegistrationTicket(env.DB, { eventId: event.id, registrationId }))!;
    let pages = 0;
    const checkout = (async () => {
      const id = `cs_test_list_${++pages}`;
      return new Response(JSON.stringify({ id, url: `https://checkout.stripe.com/c/pay/${id}` }), { status: 200 });
    }) as unknown as typeof fetch;
    for (const person of [paidOne, openOne])
      await openTicketCheckout(
        env.DB,
        paymentEnv,
        "https://example.test",
        { eventId: event.id, registrationId: person.registration.id, userId: person.user.id },
        checkout,
      );
    await paidEvent((await ticketOf(paidOne.registration.id)).id, "cs_test_list_1", 19500);

    const openTicketId = (await ticketOf(openOne.registration.id)).id;
    const list = (query: Record<string, unknown> = {}) =>
      listIssuedTickets(env.DB, event, issuedTicketsQuerySchema.parse(query));
    const before = await list();
    expect(before.page.total).toBe(2);
    expect(before.summary).toMatchObject({
      currency: "usd",
      byPayment: { paid: 1, to_pay: 1 },
      collected: 19500,
      providerFees: 0,
      awaitingAmount: 19500,
      unread: 1,
      updatable: 2,
    });
    expect((await list({ payment: "to_pay" })).tickets.map((row) => row.registrationId)).toEqual([
      openOne.registration.id,
    ]);
    expect((await list({ q: "paid-list" })).tickets.map((row) => row.payment)).toEqual(["paid"]);

    // The provider says how the first was paid and what arrived, and that the second was paid by a slow method.
    const provider = (async (url: string) => {
      const path = new URL(url).pathname;
      const body = path.startsWith("/v1/payment_intents/")
        ? {
            id: "pi_synthetic",
            status: "succeeded",
            latest_charge: {
              id: "ch_1",
              failure_code: null,
              amount_refunded: 0,
              refunded: false,
              receipt_url: "https://pay.stripe.com/receipts/synthetic",
              payment_method_details: { type: "ideal" },
              balance_transaction: { id: "txn_1", net: 18900, amount: 19500, currency: "usd" },
            },
          }
        : path === "/v1/checkout/sessions/cs_test_list_2"
          ? {
              id: "cs_test_list_2",
              status: "complete",
              payment_status: "unpaid",
              metadata: { pkic_payment_type: "event", registrationTicketId: openTicketId },
            }
          : null;
      return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
    }) as unknown as typeof fetch;
    const updated = await updateIssuedTicketsFromProvider(env.DB, paymentEnv, admin, { eventId: event.id }, provider);
    expect(updated).toMatchObject({ success: true, checked: 2, changed: 2, failed: 0, next: null });

    const after = await list({ sort: "-amount" });
    expect(after.summary).toMatchObject({
      byPayment: { paid: 1, processing: 1 },
      collected: 19500,
      providerFees: 600,
      unread: 0,
    });
    const paidRow = after.tickets.find((row) => row.registrationId === paidOne.registration.id)!;
    expect(paidRow.ticket).toMatchObject({
      paymentMethod: "ideal",
      netAmount: 18900,
      receiptUrl: "https://pay.stripe.com/receipts/synthetic",
    });
    expect(after.tickets.find((row) => row.registrationId === openOne.registration.id)!.payment).toBe("processing");

    // Only an organizer of the event reads the list.
    const path = "/api/v1/events/pqc-2026/tickets/issued";
    expect((await callApi(paymentEnv, path)).status).toBe(401);
    const token = await createMemberSession(env.DB, openOne.user.id, `session-${crypto.randomUUID()}`);
    expect((await callApi(paymentEnv, path, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
  });
});
