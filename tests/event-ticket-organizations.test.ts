import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import {
  eventTicketOrganizationListQuerySchema,
  eventTicketOrganizationListSchema,
} from "../assets/shared/schemas/event-ticket-organizations";
import { saveEventTicketType } from "../functions/_lib/services/event-tickets/configuration";
import { prepareStoreTicketDecision } from "../functions/_lib/services/event-tickets/classifier";
import {
  clearTicketOrganizationDecision,
  decideTicketOrganization,
  listTicketOrganizations,
  testTicketOrganization,
} from "../functions/_lib/services/event-tickets/organization-decisions";
import type { Env } from "../functions/_lib/types";

/** A classifier that answers every organization with fixed probabilities. */
function classifier(probabilities: Record<string, number>): Pick<Env, "AI"> {
  return { AI: { run: async () => ({ answers: { ticket: { probabilities } } }) } } as never;
}

async function seedTickets() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const event = { id: eventId, timezone: "Europe/Amsterdam" };
  let revision = 0;
  for (const input of [
    { key: "pqcc_attendee", name: "Attendee", classifierDescription: "Uses cryptography itself.", isDefault: true },
    { key: "pqcc_vendor", name: "Vendor", classifierDescription: "Sells cryptography.", isDefault: false },
  ])
    revision = (
      await saveEventTicketType(env.DB, admin, event, null, {
        expectedRevision: revision,
        descriptionMarkdown: "",
        classifierThresholdPercent: 80,
        freeRequiresWorkEmail: false,
        active: true,
        ...input,
      })
    ).revision;
  return { event, admin };
}

const query = (input: Record<string, unknown> = {}) => eventTicketOrganizationListQuerySchema.parse(input);

async function storeClassifierDecision(organizationName: string, emailDomain: string, ticketKey: string) {
  await env.DB.batch([
    prepareStoreTicketDecision(env.DB, {
      criteriaDigest: "an-earlier-question",
      subject: { organizationName, emailDomain },
      ticketKey,
      source: "classifier",
      confidence: 0.91,
      model: "synthetic",
    }),
  ]);
}

describe("ticket organizations", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("tests an organization without storing anything and shows the decision that counts", async () => {
    const { event } = await seedTickets();
    const run = vi.fn(async () => ({
      answers: { ticket: { probabilities: { pqcc_vendor: 0.6, pqcc_attendee: 0.4 } } },
    }));
    const trial = await testTicketOrganization(env.DB, { AI: { run } } as never, event, {
      organizationName: "Example Vendor",
      emailDomain: "gmail.com",
    });
    // A personal mail domain is not given to the classifier, as at registration.
    expect(trial).toEqual({
      emailDomain: null,
      answers: [
        { ticketKey: "pqcc_vendor", percent: 60, thresholdPercent: 80 },
        { ticketKey: "pqcc_attendee", percent: 40, thresholdPercent: 80 },
      ],
      decidedTicketKey: null,
      current: null,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ticket_classifier_decisions").first("n")).toBe(0);

    await storeClassifierDecision("example vendor", "", "pqcc_vendor");
    const again = await testTicketOrganization(env.DB, classifier({ pqcc_vendor: 0.9 }), event, {
      organizationName: "  Example   VENDOR ",
    });
    expect(again.decidedTicketKey).toBe("pqcc_vendor");
    expect(again.current).toEqual({ ticketKey: "pqcc_vendor", decidedBy: "classifier", confidencePercent: 91 });
  });

  it("tests a ticket's unsaved description in place of the saved one", async () => {
    const { event } = await seedTickets();
    const vendor = await env.DB.prepare("SELECT id FROM event_ticket_types WHERE ticket_key = 'pqcc_vendor'").first<{
      id: string;
    }>();
    const run = vi.fn(async (_model: string, _input: unknown) => ({
      answers: { ticket: { probabilities: { pqcc_vendor: 0.7, pqcc_attendee: 0.3 } } },
    }));
    const trial = await testTicketOrganization(env.DB, { AI: { run } } as never, event, {
      organizationName: "Example Vendor",
      draft: {
        ticketTypeId: vendor!.id,
        key: "pqcc_vendor",
        classifierDescription: "Builds cryptographic products for sale.",
        classifierThresholdPercent: 60,
        active: true,
      },
    });
    // The drafted threshold decides, and the drafted text is what the model reads.
    expect(trial.decidedTicketKey).toBe("pqcc_vendor");
    expect(trial.answers[0]).toEqual({ ticketKey: "pqcc_vendor", percent: 70, thresholdPercent: 60 });
    expect(JSON.stringify(run.mock.calls[0]?.[1])).toContain("Builds cryptographic products for sale.");
    expect(JSON.stringify(run.mock.calls[0]?.[1])).not.toContain("Sells cryptography.");

    // A ticket not added yet is asked about beside the saved ones.
    const added = await testTicketOrganization(env.DB, classifier({ pqcc_student: 0.95 }), event, {
      organizationName: "Example University",
      draft: {
        ticketTypeId: null,
        key: "pqcc_student",
        classifierDescription: "A university or school.",
        classifierThresholdPercent: 80,
        active: true,
      },
    });
    expect(added.answers.map((answer) => answer.ticketKey).sort()).toEqual([
      "pqcc_attendee",
      "pqcc_student",
      "pqcc_vendor",
    ]);
    expect(added.decidedTicketKey).toBe("pqcc_student");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM event_ticket_types").first("n")).toBe(2);
  });

  it("refuses a test when the classifier does not answer", async () => {
    const { event } = await seedTickets();
    await expect(
      testTicketOrganization(env.DB, {}, event, { organizationName: "Example Vendor" }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("saves an organizer's decision over the classifier's and lists one row per organization", async () => {
    const { event, admin } = await seedTickets();
    await storeClassifierDecision("example vendor", "vendor-example.test", "pqcc_attendee");
    await storeClassifierDecision("example university", "", "pqcc_attendee");
    await decideTicketOrganization(env.DB, admin, event, {
      organizationName: "Example Vendor",
      emailDomain: "Vendor-Example.test",
      ticketKey: "pqcc_vendor",
    });

    const all = await listTicketOrganizations(env.DB, event, query({ sort: "organization" }));
    expect(all.page.total).toBe(2);
    expect(
      all.organizations.map(({ organizationName, emailDomain, ticketKey, decidedBy, confidencePercent }) => ({
        organizationName,
        emailDomain,
        ticketKey,
        decidedBy,
        confidencePercent,
      })),
    ).toEqual([
      {
        organizationName: "example university",
        emailDomain: "",
        ticketKey: "pqcc_attendee",
        decidedBy: "classifier",
        confidencePercent: 91,
      },
      {
        organizationName: "example vendor",
        emailDomain: "vendor-example.test",
        ticketKey: "pqcc_vendor",
        decidedBy: "organizer",
        confidencePercent: null,
      },
    ]);
    const byOrganizer = await listTicketOrganizations(env.DB, event, query({ decidedBy: "organizer" }));
    expect(byOrganizer.organizations.map((row) => row.organizationName)).toEqual(["example vendor"]);
    const searched = await listTicketOrganizations(env.DB, event, query({ q: "university" }));
    expect(searched.organizations.map((row) => row.organizationName)).toEqual(["example university"]);
    expect(
      await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'ticket_organization_decided'").first("action"),
    ).toBe("ticket_organization_decided");
  });

  it("refuses a decision for a ticket the event does not offer", async () => {
    const { event, admin } = await seedTickets();
    await expect(
      decideTicketOrganization(env.DB, admin, event, { organizationName: "Example Vendor", ticketKey: "pqcc_speaker" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("clears every decision that counts for an organization", async () => {
    const { event, admin } = await seedTickets();
    await storeClassifierDecision("example vendor", "", "pqcc_attendee");
    await decideTicketOrganization(env.DB, admin, event, {
      organizationName: "Example Vendor",
      ticketKey: "pqcc_vendor",
    });
    await storeClassifierDecision("example university", "", "pqcc_attendee");
    const [vendor] = (await listTicketOrganizations(env.DB, event, query({ decidedBy: "organizer" }))).organizations;

    await clearTicketOrganizationDecision(env.DB, admin, event, vendor.id);
    const left = await listTicketOrganizations(env.DB, event, query());
    expect(left.organizations.map((row) => row.organizationName)).toEqual(["example university"]);
    await expect(clearTicketOrganizationDecision(env.DB, admin, event, vendor.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("replaces an organizer's decision made under earlier criteria", async () => {
    const { event, admin } = await seedTickets();
    await env.DB.batch([
      prepareStoreTicketDecision(env.DB, {
        criteriaDigest: "an-earlier-question",
        subject: { organizationName: "Example Vendor", emailDomain: null },
        ticketKey: "pqcc_attendee",
        source: "organizer",
        confidence: null,
        model: null,
      }),
    ]);
    await decideTicketOrganization(env.DB, admin, event, {
      organizationName: "Example Vendor",
      ticketKey: "pqcc_vendor",
    });
    const rows = await env.DB.prepare(
      "SELECT ticket_key FROM ticket_classifier_decisions WHERE organization_name = 'example vendor' AND source = 'organizer'",
    ).all<{ ticket_key: string }>();
    expect(rows.results.map((row) => row.ticket_key)).toEqual(["pqcc_vendor"]);
  });

  it("keeps each event's decision when the events offer different tickets", async () => {
    const { admin } = await seedEventAndAdmin(env.DB);
    const events = [];
    for (const prefix of ["first", "second"]) {
      const event = { id: crypto.randomUUID(), timezone: "Europe/Amsterdam" };
      await env.DB.prepare(
        `INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, source_path, capacity_in_person, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, 'Europe/Amsterdam', '2026-12-01T08:00:00.000Z', '2026-12-03T18:00:00.000Z', ?, 1, 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
      )
        .bind(event.id, `${prefix}-event`, `${prefix} event`, `content/events/${prefix}/_index.md`)
        .run();
      let revision = 0;
      for (const [index, name] of ["Attendee", "Vendor"].entries())
        revision = (
          await saveEventTicketType(env.DB, admin, event, null, {
            expectedRevision: revision,
            key: `${prefix}_${name.toLowerCase()}`,
            name,
            descriptionMarkdown: "",
            classifierDescription: "",
            classifierThresholdPercent: 80,
            freeRequiresWorkEmail: false,
            isDefault: index === 0,
            active: true,
          })
        ).revision;
      events.push(event);
    }
    const [firstEvent, secondEvent] = events;
    await decideTicketOrganization(env.DB, admin, firstEvent, {
      organizationName: "Example Vendor",
      ticketKey: "first_vendor",
    });
    await decideTicketOrganization(env.DB, admin, secondEvent, {
      organizationName: "Example Vendor",
      ticketKey: "second_attendee",
    });
    const tickets = async (event: { id: string; timezone: string }) =>
      (await listTicketOrganizations(env.DB, event, query())).organizations.map((row) => row.ticketKey);
    expect(await tickets(firstEvent)).toEqual(["first_vendor"]);
    expect(await tickets(secondEvent)).toEqual(["second_attendee"]);
  });

  it("clears only a decision that counts for this event's tickets", async () => {
    const { event, admin } = await seedTickets();
    await storeClassifierDecision("example vendor", "", "another_event_ticket");
    const foreign = await env.DB.prepare("SELECT id FROM ticket_classifier_decisions").first<{ id: string }>();
    await expect(clearTicketOrganizationDecision(env.DB, admin, event, foreign!.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ticket_classifier_decisions").first("n")).toBe(1);
  });

  it("refuses the organizations to a signed-in user who cannot manage the event", async () => {
    await seedTickets();
    await storeClassifierDecision("example vendor", "", "pqcc_vendor");
    const userId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, email, normalized_email, active) VALUES (?, ?, ?, 1)")
      .bind(userId, "visitor@example.test", "visitor@example.test")
      .run();
    const token = await createMemberSession(env.DB, userId, `visitor-${crypto.randomUUID()}`, undefined, null);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const path = "/api/v1/events/pqc-2026/tickets/organizations";
    const id = (await env.DB.prepare("SELECT id FROM ticket_classifier_decisions").first<{ id: string }>())!.id;
    for (const [url, init] of [
      [path, { headers }],
      [`${path}/decisions/${id}`, { method: "DELETE", headers }],
      [
        `${path}/decisions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ organizationName: "Example Vendor", ticketKey: "pqcc_attendee" }),
        },
      ],
    ] as const)
      expect((await callApi(env, url, init)).status).toBe(403);
    expect(await env.DB.prepare("SELECT ticket_key FROM ticket_classifier_decisions").first("ticket_key")).toBe(
      "pqcc_vendor",
    );
  });

  it("serves the organizations to an organizer through the event's tickets", async () => {
    const { admin } = await seedTickets();
    await storeClassifierDecision("example vendor", "", "pqcc_vendor");
    const token = await createAdminSession(env.DB, admin.id, `organizations-${crypto.randomUUID()}`);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const path = "/api/v1/events/pqc-2026/tickets/organizations";
    const listed = await callApi(env, path, { headers });
    expect(listed.status).toBe(200);
    const [row] = eventTicketOrganizationListSchema.parse(await listed.json()).organizations;
    const cleared = await callApi(env, `${path}/decisions/${row.id}`, { method: "DELETE", headers });
    expect(cleared.status).toBe(200);
    const decided = await callApi(env, `${path}/decisions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ organizationName: "Example Vendor", ticketKey: "pqcc_vendor" }),
    });
    expect(decided.status).toBe(200);
  });
});
