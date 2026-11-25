import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
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
  decideTicketOrganizations,
  listTicketOrganizations,
  testTicketOrganizations,
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

/** A portal organization with its claimed domains. */
async function organization(name: string, domains: readonly string[] = []): Promise<string> {
  const id = crypto.randomUUID();
  const now = "2026-11-01T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, name, name.toLowerCase(), now, now),
    ...domains.map((domain) =>
      env.DB.prepare(
        "INSERT INTO organization_domain_claims (id, domain, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), domain, id, now, now),
    ),
  ]);
  return id;
}

async function storeClassifierDecision(organizationId: string, ticketKey: string) {
  await env.DB.batch([
    prepareStoreTicketDecision(env.DB, {
      organizationId,
      ticketKey,
      source: "classifier",
      confidence: 0.91,
      model: "synthetic",
    }),
  ]);
}

const decisionCount = () => env.DB.prepare("SELECT COUNT(*) AS n FROM ticket_organization_decisions").first("n");

describe("ticket organizations", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("tests a portal organization by its name and every domain, and stores nothing", async () => {
    const { event } = await seedTickets();
    const vendor = await organization("Example Vendor", ["vendor-example.test", "vendor-group.test"]);
    const run = vi.fn(async (_model: string, _input: unknown) => ({
      answers: { ticket: { probabilities: { pqcc_vendor: 0.6, pqcc_attendee: 0.4 } } },
    }));
    const trial = await testTicketOrganizations(env.DB, { AI: { run } } as never, event, {
      organizations: [{ organizationId: vendor }],
    });
    expect(trial.results).toEqual([
      {
        organizationId: vendor,
        organizationName: "Example Vendor",
        domains: ["vendor-example.test", "vendor-group.test"],
        answers: [
          { ticketKey: "pqcc_vendor", percent: 60, thresholdPercent: 80 },
          { ticketKey: "pqcc_attendee", percent: 40, thresholdPercent: 80 },
        ],
        decidedTicketKey: null,
        current: null,
        error: null,
      },
    ]);
    expect(JSON.stringify(run.mock.calls[0]?.[1])).toContain("vendor-example.test, vendor-group.test");
    expect(await decisionCount()).toBe(0);

    await storeClassifierDecision(vendor, "pqcc_vendor");
    const [again] = (
      await testTicketOrganizations(env.DB, classifier({ pqcc_vendor: 0.9 }), event, {
        organizations: [{ organizationId: vendor }],
      })
    ).results;
    expect(again.decidedTicketKey).toBe("pqcc_vendor");
    expect(again.current).toEqual({ ticketKey: "pqcc_vendor", decidedBy: "classifier", confidencePercent: 91 });
  });

  it("tests a typed organization without its personal mail domains", async () => {
    const { event } = await seedTickets();
    const [trial] = (
      await testTicketOrganizations(env.DB, classifier({ pqcc_vendor: 0.9 }), event, {
        organizations: [{ organizationName: "Example Vendor", domains: ["gmail.com", "Vendor-Example.test"] }],
      })
    ).results;
    expect(trial).toMatchObject({
      organizationId: null,
      domains: ["vendor-example.test"],
      decidedTicketKey: "pqcc_vendor",
      current: null,
    });
  });

  it("reports a portal organization that is gone", async () => {
    const { event } = await seedTickets();
    const kept = await organization("Kept Co");
    const { results } = await testTicketOrganizations(env.DB, classifier({ pqcc_vendor: 0.9 }), event, {
      organizations: [{ organizationId: crypto.randomUUID() }, { organizationId: kept }],
    });
    expect(results.map((result) => result.error)).toEqual(["not_found", null]);
  });

  it("tests a ticket's unsaved description in place of the saved one", async () => {
    const { event } = await seedTickets();
    const vendor = await env.DB.prepare("SELECT id FROM event_ticket_types WHERE ticket_key = 'pqcc_vendor'").first<{
      id: string;
    }>();
    const run = vi.fn(async (_model: string, _input: unknown) => ({
      answers: { ticket: { probabilities: { pqcc_vendor: 0.7, pqcc_attendee: 0.3 } } },
    }));
    const [trial] = (
      await testTicketOrganizations(env.DB, { AI: { run } } as never, event, {
        organizations: [{ organizationName: "Example Vendor", domains: [] }],
        draft: {
          ticketTypeId: vendor!.id,
          key: "pqcc_vendor",
          classifierDescription: "Builds cryptographic products for sale.",
          classifierThresholdPercent: 60,
          active: true,
        },
      })
    ).results;
    // The drafted threshold decides, and the drafted text is what the model reads.
    expect(trial.decidedTicketKey).toBe("pqcc_vendor");
    expect(trial.answers?.[0]).toEqual({ ticketKey: "pqcc_vendor", percent: 70, thresholdPercent: 60 });
    expect(JSON.stringify(run.mock.calls[0]?.[1])).toContain("Builds cryptographic products for sale.");
    expect(JSON.stringify(run.mock.calls[0]?.[1])).not.toContain("Sells cryptography.");

    // A ticket not added yet is asked about beside the saved ones.
    const [added] = (
      await testTicketOrganizations(env.DB, classifier({ pqcc_student: 0.95 }), event, {
        organizations: [{ organizationName: "Example University", domains: [] }],
        draft: {
          ticketTypeId: null,
          key: "pqcc_student",
          classifierDescription: "A university or school.",
          classifierThresholdPercent: 80,
          active: true,
        },
      })
    ).results;
    expect(added.answers?.map((answer) => answer.ticketKey).sort()).toEqual([
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
      testTicketOrganizations(env.DB, {}, event, {
        organizations: [{ organizationName: "Example Vendor", domains: [] }],
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("saves an organizer's decision over the classifier's and lists one row per organization", async () => {
    const { event, admin } = await seedTickets();
    const vendor = await organization("Example Vendor", ["vendor-example.test"]);
    const university = await organization("Example University");
    await storeClassifierDecision(vendor, "pqcc_attendee");
    await storeClassifierDecision(university, "pqcc_attendee");
    await decideTicketOrganizations(env.DB, admin, event, {
      decisions: [{ organizationId: vendor, ticketKey: "pqcc_vendor" }],
    });

    const all = await listTicketOrganizations(env.DB, event, query({ sort: "organization" }));
    expect(all.page.total).toBe(2);
    expect(
      all.organizations.map(({ organizationName, domains, ticketKey, decidedBy, confidencePercent }) => ({
        organizationName,
        domains,
        ticketKey,
        decidedBy,
        confidencePercent,
      })),
    ).toEqual([
      {
        organizationName: "Example University",
        domains: [],
        ticketKey: "pqcc_attendee",
        decidedBy: "classifier",
        confidencePercent: 91,
      },
      {
        organizationName: "Example Vendor",
        domains: ["vendor-example.test"],
        ticketKey: "pqcc_vendor",
        decidedBy: "organizer",
        confidencePercent: null,
      },
    ]);
    const byOrganizer = await listTicketOrganizations(env.DB, event, query({ decidedBy: "organizer" }));
    expect(byOrganizer.organizations.map((row) => row.organizationName)).toEqual(["Example Vendor"]);
    const searched = await listTicketOrganizations(env.DB, event, query({ q: "university" }));
    expect(searched.organizations.map((row) => row.organizationName)).toEqual(["Example University"]);
    expect(
      await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'ticket_organization_decided'").first("action"),
    ).toBe("ticket_organization_decided");
  });

  it("keeps a decision when the organization is renamed", async () => {
    const { event, admin } = await seedTickets();
    const vendor = await organization("Example Vendor");
    await decideTicketOrganizations(env.DB, admin, event, {
      decisions: [{ organizationId: vendor, ticketKey: "pqcc_vendor" }],
    });
    await env.DB.prepare("UPDATE organizations SET name = 'Example  VENDOR Group' WHERE id = ?").bind(vendor).run();
    const [row] = (await listTicketOrganizations(env.DB, event, query())).organizations;
    expect([row?.organizationName, row?.ticketKey]).toEqual(["Example  VENDOR Group", "pqcc_vendor"]);
  });

  it("refuses a decision for a ticket the event does not offer or an organization that is gone", async () => {
    const { event, admin } = await seedTickets();
    const vendor = await organization("Example Vendor");
    await expect(
      decideTicketOrganizations(env.DB, admin, event, {
        decisions: [{ organizationId: vendor, ticketKey: "pqcc_speaker" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      decideTicketOrganizations(env.DB, admin, event, {
        decisions: [{ organizationId: crypto.randomUUID(), ticketKey: "pqcc_vendor" }],
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await decisionCount()).toBe(0);
  });

  it("clears every decision that counts for an organization", async () => {
    const { event, admin } = await seedTickets();
    const vendor = await organization("Example Vendor");
    const university = await organization("Example University");
    await decideTicketOrganizations(env.DB, admin, event, {
      decisions: [{ organizationId: vendor, ticketKey: "pqcc_vendor" }],
    });
    await storeClassifierDecision(vendor, "pqcc_attendee");
    await storeClassifierDecision(university, "pqcc_attendee");
    const countFor = (organizationId: string) =>
      env.DB.prepare("SELECT COUNT(*) AS n FROM ticket_organization_decisions WHERE organization_id = ?")
        .bind(organizationId)
        .first("n");
    expect(await countFor(vendor)).toBe(2);
    const [listed] = (await listTicketOrganizations(env.DB, event, query({ decidedBy: "organizer" }))).organizations;

    await clearTicketOrganizationDecision(env.DB, admin, event, listed.id!);
    expect(await countFor(vendor)).toBe(0);
    expect(await countFor(university)).toBe(1);
    await expect(clearTicketOrganizationDecision(env.DB, admin, event, listed.id!)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("replaces the organization's earlier decision among these tickets", async () => {
    const { event, admin } = await seedTickets();
    const vendor = await organization("Example Vendor");
    await env.DB.batch([
      prepareStoreTicketDecision(env.DB, {
        organizationId: vendor,
        ticketKey: "pqcc_attendee",
        source: "organizer",
        confidence: null,
        model: null,
      }),
    ]);
    await decideTicketOrganizations(env.DB, admin, event, {
      decisions: [{ organizationId: vendor, ticketKey: "pqcc_vendor" }],
    });
    const rows = await env.DB.prepare(
      "SELECT ticket_key FROM ticket_organization_decisions WHERE organization_id = ? AND source = 'organizer'",
    )
      .bind(vendor)
      .all<{ ticket_key: string }>();
    expect(rows.results.map((row) => row.ticket_key)).toEqual(["pqcc_vendor"]);
  });

  it("keeps each event's decision when the events offer different tickets", async () => {
    const { admin } = await seedEventAndAdmin(env.DB);
    const vendor = await organization("Example Vendor");
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
    await decideTicketOrganizations(env.DB, admin, firstEvent, {
      decisions: [{ organizationId: vendor, ticketKey: "first_vendor" }],
    });
    await decideTicketOrganizations(env.DB, admin, secondEvent, {
      decisions: [{ organizationId: vendor, ticketKey: "second_attendee" }],
    });
    const tickets = async (event: { id: string; timezone: string }) =>
      (await listTicketOrganizations(env.DB, event, query())).organizations.map((row) => row.ticketKey);
    expect(await tickets(firstEvent)).toEqual(["first_vendor"]);
    expect(await tickets(secondEvent)).toEqual(["second_attendee"]);
  });

  it("clears only a decision that counts for this event's tickets", async () => {
    const { event, admin } = await seedTickets();
    await storeClassifierDecision(await organization("Example Vendor"), "another_event_ticket");
    const foreign = await env.DB.prepare("SELECT id FROM ticket_organization_decisions").first<{ id: string }>();
    await expect(clearTicketOrganizationDecision(env.DB, admin, event, foreign!.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await decisionCount()).toBe(1);
  });

  it("refuses the organizations to a signed-in user who cannot manage the event", async () => {
    await seedTickets();
    const vendor = await organization("Example Vendor");
    await storeClassifierDecision(vendor, "pqcc_vendor");
    const userId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, email, normalized_email, active) VALUES (?, ?, ?, 1)")
      .bind(userId, "visitor@example.test", "visitor@example.test")
      .run();
    const token = await createMemberSession(env.DB, userId, `visitor-${crypto.randomUUID()}`, undefined, null);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const path = "/api/v1/events/pqc-2026/tickets/organizations";
    const id = (await env.DB.prepare("SELECT id FROM ticket_organization_decisions").first<{ id: string }>())!.id;
    for (const [url, init] of [
      [path, { headers }],
      [`${path}/decisions/${id}`, { method: "DELETE", headers }],
      [
        `${path}/decisions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ decisions: [{ organizationId: vendor, ticketKey: "pqcc_attendee" }] }),
        },
      ],
    ] as const)
      expect((await callApi(env, url, init)).status).toBe(403);
    expect(await env.DB.prepare("SELECT ticket_key FROM ticket_organization_decisions").first("ticket_key")).toBe(
      "pqcc_vendor",
    );
  });

  it("serves the organizations to an organizer through the event's tickets", async () => {
    const { admin } = await seedTickets();
    const vendor = await organization("Example Vendor");
    await storeClassifierDecision(vendor, "pqcc_vendor");
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
      body: JSON.stringify({ decisions: [{ organizationId: vendor, ticketKey: "pqcc_vendor" }] }),
    });
    expect(decided.status).toBe(200);
    const before = await decisionCount();
    const empty = await callApi(env, `${path}/decisions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decisions: [] }),
    });
    expect(empty.status).toBe(400);
    expect(await decisionCount()).toBe(before);
  });

  it("saves nothing when the tickets or the organizations changed after they were checked", async () => {
    const { event, admin } = await seedTickets();
    const vendor = await organization("Example Vendor");
    await organization("Example Vendor Group");
    const writing = (sql: string) => sql.startsWith("DELETE FROM ticket_organization_decisions");
    const changing = (sql: string) =>
      mutateBeforeMatchingQuery(env.DB, writing, () => env.DB.prepare(sql).bind(vendor).run());
    for (const sql of [
      "UPDATE event_ticket_settings SET revision = revision + 1 WHERE ? IS NOT NULL",
      `UPDATE organizations SET merged_into_organization_id = (SELECT id FROM organizations WHERE id <> ?1 LIMIT 1)
        WHERE id = ?1`,
    ])
      await expect(
        decideTicketOrganizations(changing(sql), admin, event, {
          decisions: [{ organizationId: vendor, ticketKey: "pqcc_vendor" }],
        }),
      ).rejects.toMatchObject({ status: 409, code: "TICKET_DECISIONS_CHANGED" });
    expect(await decisionCount()).toBe(0);
  });

  it("clears nothing when the decision was replaced after it was read", async () => {
    const { event, admin } = await seedTickets();
    const vendor = await organization("Example Vendor");
    await decideTicketOrganizations(env.DB, admin, event, {
      decisions: [{ organizationId: vendor, ticketKey: "pqcc_vendor" }],
    });
    const [listed] = (await listTicketOrganizations(env.DB, event, query())).organizations;
    const replacing = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("DELETE FROM ticket_organization_decisions"),
      () =>
        decideTicketOrganizations(env.DB, admin, event, {
          decisions: [{ organizationId: vendor, ticketKey: "pqcc_attendee" }],
        }),
    );
    await expect(clearTicketOrganizationDecision(replacing, admin, event, listed.id!)).rejects.toMatchObject({
      status: 409,
    });
    expect(await env.DB.prepare("SELECT ticket_key FROM ticket_organization_decisions").first("ticket_key")).toBe(
      "pqcc_attendee",
    );
  });

  it("clears nothing when the tickets changed after they were read", async () => {
    const { event, admin } = await seedTickets();
    const vendor = await organization("Example Vendor");
    await decideTicketOrganizations(env.DB, admin, event, {
      decisions: [{ organizationId: vendor, ticketKey: "pqcc_vendor" }],
    });
    const [listed] = (await listTicketOrganizations(env.DB, event, query())).organizations;
    const renaming = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("DELETE FROM ticket_organization_decisions"),
      () => env.DB.prepare("UPDATE event_ticket_settings SET revision = revision + 1").run(),
    );
    await expect(clearTicketOrganizationDecision(renaming, admin, event, listed.id!)).rejects.toMatchObject({
      status: 409,
      code: "TICKET_DECISIONS_CHANGED",
    });
    expect(await decisionCount()).toBe(1);
  });

  it("lists every domain an organization is recognized by, though the classifier is given ten", async () => {
    const { event } = await seedTickets();
    const domains = Array.from({ length: 11 }, (_, index) => `d${String(index).padStart(2, "0")}.example.test`);
    await organization("Many Domains", domains);
    const listed = await listTicketOrganizations(env.DB, event, query({ among: "portal", q: "d10.example.test" }));
    expect(listed.organizations.map((row) => row.domains)).toEqual([domains]);
  });

  it("lists the portal's organizations with the decision that counts for each", async () => {
    const { event, admin } = await seedTickets();
    const alpha = await organization("Alpha Secure", ["alpha-secure.test"]);
    const beta = await organization("Beta Systems", ["beta-systems.test", "beta.test"]);
    const gamma = await organization("Gamma  LABS", ["gamma.test"]);
    await decideTicketOrganizations(env.DB, admin, event, {
      decisions: [
        { organizationId: alpha, ticketKey: "pqcc_vendor" },
        { organizationId: gamma, ticketKey: "pqcc_attendee" },
      ],
    });

    const all = await listTicketOrganizations(env.DB, event, query({ among: "portal", sort: "organization" }));
    expect(all.page.total).toBe(3);
    expect(
      all.organizations.map((row) => [
        row.organizationId,
        row.organizationName,
        row.domains,
        row.ticketKey,
        row.decidedBy,
      ]),
    ).toEqual([
      [alpha, "Alpha Secure", ["alpha-secure.test"], "pqcc_vendor", "organizer"],
      [beta, "Beta Systems", ["beta-systems.test", "beta.test"], null, null],
      [gamma, "Gamma  LABS", ["gamma.test"], "pqcc_attendee", "organizer"],
    ]);
    expect(all.organizations[0]?.id).not.toBeNull();
    expect(all.organizations[1]?.id).toBeNull();

    const byDomain = await listTicketOrganizations(env.DB, event, query({ among: "portal", q: "beta.test" }));
    expect(byDomain.organizations.map((row) => row.organizationName)).toEqual(["Beta Systems"]);
    const byName = await listTicketOrganizations(env.DB, event, query({ among: "portal", q: "alpha" }));
    expect(byName.organizations.map((row) => row.organizationName)).toEqual(["Alpha Secure"]);
    const vendors = await listTicketOrganizations(env.DB, event, query({ among: "portal", ticketKey: "pqcc_vendor" }));
    expect(vendors.organizations.map((row) => row.organizationName)).toEqual(["Alpha Secure"]);
    const paged = await listTicketOrganizations(
      env.DB,
      event,
      query({ among: "portal", sort: "organization", limit: 1, offset: 1 }),
    );
    expect(paged.page.total).toBe(3);
    expect(paged.organizations.map((row) => row.organizationName)).toEqual(["Beta Systems"]);
  });

  it("tests several organizations and reports the one the classifier did not answer for", async () => {
    const { event } = await seedTickets();
    const run = vi.fn(async (_model: string, input: unknown) => {
      if (JSON.stringify(input).includes("Flaky Co")) throw new Error("model down");
      return { answers: { ticket: { probabilities: { pqcc_vendor: 0.9, pqcc_attendee: 0.1 } } } };
    });
    const { results } = await testTicketOrganizations(env.DB, { AI: { run } } as never, event, {
      organizations: [
        { organizationName: "Flaky Co", domains: [] },
        { organizationName: "Steady Co", domains: [] },
      ],
    });
    expect(results.map((result) => [result.organizationName, result.error, result.decidedTicketKey])).toEqual([
      ["Flaky Co", "unavailable", null],
      ["Steady Co", null, "pqcc_vendor"],
    ]);
    expect(results[0]?.answers).toBeNull();
    await expect(
      testTicketOrganizations(env.DB, {}, event, {
        organizations: [
          { organizationName: "A Co", domains: [] },
          { organizationName: "B Co", domains: [] },
        ],
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("saves several decisions together and refuses all of them when one ticket is not offered", async () => {
    const { event, admin } = await seedTickets();
    const [first, second, third, fourth] = await Promise.all(
      ["First Co", "Second Co", "Third Co", "Fourth Co"].map((name) => organization(name)),
    );
    await decideTicketOrganizations(env.DB, admin, event, {
      decisions: [
        { organizationId: first!, ticketKey: "pqcc_vendor" },
        { organizationId: second!, ticketKey: "pqcc_attendee" },
      ],
    });
    expect(await decisionCount()).toBe(2);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'ticket_organization_decided'").first(
        "n",
      ),
    ).toBe(2);

    await expect(
      decideTicketOrganizations(env.DB, admin, event, {
        decisions: [
          { organizationId: third!, ticketKey: "pqcc_vendor" },
          { organizationId: fourth!, ticketKey: "pqcc_speaker" },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await decisionCount()).toBe(2);
  });
});
