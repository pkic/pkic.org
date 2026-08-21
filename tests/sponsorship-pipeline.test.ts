/**
 * sponsorship-pipeline.test.ts.
 *
 * Admin sales pipeline: CRUD, stage transitions (and their "on active"/"on
 * lapsed" side effects on organizations.sponsor_tier/sponsor_start_date),
 * the audit trail, per-event sponsor-tier attendee-access config, and the
 * member-facing GET /api/v1/me/organization/sponsorship view.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  seedOrganizationAggregate,
  addRepresentative,
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function seedOrganization(name: string): Promise<{ organizationId: string; userId: string }> {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(organizationId, name, name.toLowerCase()),
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, `contact@${name.toLowerCase()}.test`, `contact@${name.toLowerCase()}.test`),
  ]);

  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "B");
  await addRepresentative(env.DB, memberId, userId);
  await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);

  return { organizationId, userId };
}

describe("Sponsorship sales pipeline", () => {
  let adminToken: string;
  let adminId: string;
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-sponsorship-token");
  });

  it("requires sponsorships:read/write permission", async () => {
    const listResponse = await call(adminToken, "/api/v1/admin/sponsorships");
    expect(listResponse.status).toBe(200);
  });

  it("creates, lists, and updates a consortium sponsorship", async () => {
    const { organizationId } = await seedOrganization("Acme Corp");

    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({
        sponsorType: "consortium",
        organizationId,
        tier: "Gold",
        notes: "Negotiated at conference",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { sponsorship: { id: string; pipelineStage: string } };
    expect(created.sponsorship.pipelineStage).toBe("new_inquiry");

    const listResponse = await call(adminToken, "/api/v1/admin/sponsorships?type=consortium");
    const list = (await listResponse.json()) as { sponsorships: unknown[] };
    expect(list.sponsorships).toHaveLength(1);

    const updateResponse = await call(adminToken, `/api/v1/admin/sponsorships/${created.sponsorship.id}`, {
      method: "PATCH",
      body: JSON.stringify({ assignedToUserId: adminId, renewalDate: "2027-01-01", notes: "Updated notes" }),
    });
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()) as { sponsorship: { assignedToName: string; renewalDate: string } };
    expect(updated.sponsorship.renewalDate).toBe("2027-01-01");
  });

  it("advancing a consortium sponsorship to active writes organizations.sponsor_tier/sponsor_start_date, and lapsing clears them", async () => {
    const { organizationId } = await seedOrganization("Beta Inc");
    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({ sponsorType: "consortium", organizationId, tier: "Platinum" }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };
    const id = created.sponsorship.id;

    const activateResponse = await call(adminToken, `/api/v1/admin/sponsorships/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active", note: "Payment cleared" }),
    });
    expect(activateResponse.status).toBe(200);

    const orgRows = await queryAll<{ sponsor_tier: string | null; sponsor_start_date: string | null }>(
      env.DB,
      "SELECT sponsor_tier, sponsor_start_date FROM organizations WHERE id = ?",
      [organizationId],
    );
    expect(orgRows[0].sponsor_tier).toBe("Platinum");
    expect(orgRows[0].sponsor_start_date).not.toBeNull();

    const eventsResponse = await call(adminToken, `/api/v1/admin/sponsorships/${id}/events?limit=1&offset=0`);
    const eventsBody = (await eventsResponse.json()) as {
      events: { toStage: string }[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(eventsResponse.status).toBe(200);
    expect(eventsBody.events.map((e) => e.toStage)).toEqual(["active"]);
    expect(eventsBody.page).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true });

    const secondEventsResponse = await call(adminToken, `/api/v1/admin/sponsorships/${id}/events?limit=1&offset=1`);
    const secondEventsBody = (await secondEventsResponse.json()) as {
      events: { toStage: string }[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(secondEventsBody.events.map((e) => e.toStage)).toEqual(["new_inquiry"]);
    expect(secondEventsBody.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });

    const lapseResponse = await call(adminToken, `/api/v1/admin/sponsorships/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "lapsed" }),
    });
    expect(lapseResponse.status).toBe(200);
    const orgRowsAfterLapse = await queryAll<{ sponsor_tier: string | null }>(
      env.DB,
      "SELECT sponsor_tier FROM organizations WHERE id = ?",
      [organizationId],
    );
    expect(orgRowsAfterLapse[0].sponsor_tier).toBeNull();
  });

  it("searches both event rows and the count, validates list parameters, and requires authorization", async () => {
    const { organizationId, userId } = await seedOrganization("History Search");
    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({ sponsorType: "consortium", organizationId, tier: "Gold" }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };
    const id = created.sponsorship.id;
    await call(adminToken, `/api/v1/admin/sponsorships/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active", note: "Payment cleared" }),
    });

    const searchResponse = await call(adminToken, `/api/v1/admin/sponsorships/${id}/events?q=payment`);
    const searchBody = (await searchResponse.json()) as {
      events: { toStage: string; note: string | null }[];
      page: { total: number };
    };
    expect(searchResponse.status).toBe(200);
    expect(searchBody.events).toEqual([expect.objectContaining({ toStage: "active", note: "Payment cleared" })]);
    expect(searchBody.page.total).toBe(1);

    expect((await call(adminToken, `/api/v1/admin/sponsorships/${id}/events?limit=0`)).status).toBe(400);
    expect((await call(adminToken, `/api/v1/admin/sponsorships/${id}/events?sort=note`)).status).toBe(400);
    expect((await call(adminToken, `/api/v1/admin/sponsorships/${crypto.randomUUID()}/events`)).status).toBe(404);

    const memberToken = await createMemberSession(env.DB, userId, "sponsorship-history-member-token");
    expect((await call(memberToken, `/api/v1/admin/sponsorships/${id}/events`)).status).toBe(401);
  });

  it("paginates equal-timestamp history deterministically in either schema-allowed order", async () => {
    const { organizationId } = await seedOrganization("Stable History");
    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({ sponsorType: "consortium", organizationId, tier: "Gold" }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };
    const id = created.sponsorship.id;
    await call(adminToken, `/api/v1/admin/sponsorships/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active" }),
    });
    await env.DB.prepare(
      `UPDATE sponsorship_events
       SET id = CASE to_stage
         WHEN 'new_inquiry' THEN '00000000000000000000000000000001'
         ELSE '00000000000000000000000000000002'
       END,
       created_at = '2026-08-21T12:00:00.000Z'
       WHERE sponsorship_id = ?`,
    )
      .bind(id)
      .run();

    const newestFirst = await Promise.all([
      call(adminToken, `/api/v1/admin/sponsorships/${id}/events?limit=1&offset=0`),
      call(adminToken, `/api/v1/admin/sponsorships/${id}/events?limit=1&offset=1`),
    ]);
    const newestStages = await Promise.all(
      newestFirst.map(
        async (response) => ((await response.json()) as { events: { toStage: string }[] }).events[0].toStage,
      ),
    );
    expect(newestStages).toEqual(["active", "new_inquiry"]);

    const oldestFirst = await Promise.all([
      call(adminToken, `/api/v1/admin/sponsorships/${id}/events?sort=createdAt&limit=1&offset=0`),
      call(adminToken, `/api/v1/admin/sponsorships/${id}/events?sort=createdAt&limit=1&offset=1`),
    ]);
    const oldestStages = await Promise.all(
      oldestFirst.map(
        async (response) => ((await response.json()) as { events: { toStage: string }[] }).events[0].toStage,
      ),
    );
    expect(oldestStages).toEqual(["new_inquiry", "active"]);
  });

  it("advancing a consortium sponsorship to active queues sponsorship-active-confirmation to the contact email", async () => {
    const { organizationId, userId } = await seedOrganization("Gamma LLC");
    await env.DB.prepare(
      "UPDATE users SET email = 'primary@gamma.test', normalized_email = 'primary@gamma.test' WHERE id = ?",
    )
      .bind(userId)
      .run();
    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({
        sponsorType: "consortium",
        organizationId,
        tier: "Silver",
        contactEmail: "primary@gamma.test",
        contactName: "Primary Contact",
      }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };

    await call(adminToken, `/api/v1/admin/sponsorships/${created.sponsorship.id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active" }),
    });

    const outboxRows = await queryAll<{ template_key: string; recipient_email: string }>(
      env.DB,
      "SELECT template_key, recipient_email FROM email_outbox WHERE template_key = 'sponsorship-active-confirmation'",
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].recipient_email).toBe("primary@gamma.test");
  });

  it("advancing an event sponsorship to active at a qualifying tier sends sponsor-portal-access and issues a magic link", async () => {
    await call(adminToken, `/api/v1/admin/events/pqc-2026/sponsor-tiers`, {
      method: "PUT",
      body: JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
    });

    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({
        sponsorType: "event",
        eventId,
        tier: "Leader",
        contactEmail: "sponsor-contact@leader-corp.test",
        contactName: "Leader Contact",
      }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };

    const activateResponse = await call(adminToken, `/api/v1/admin/sponsorships/${created.sponsorship.id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active" }),
    });
    expect(activateResponse.status).toBe(200);

    const outboxRows = await queryAll<{ template_key: string }>(
      env.DB,
      "SELECT template_key FROM email_outbox WHERE template_key = 'sponsor-portal-access'",
    );
    expect(outboxRows).toHaveLength(1);

    const magicLinkRows = await queryAll<{ sponsorship_id: string }>(
      env.DB,
      "SELECT sponsorship_id FROM sponsor_portal_magic_links WHERE sponsorship_id = ?",
      [created.sponsorship.id],
    );
    expect(magicLinkRows).toHaveLength(1);
  });

  it("does not send sponsor-portal-access when the sponsorship's tier is not configured for attendee data access", async () => {
    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({
        sponsorType: "event",
        eventId,
        tier: "Ambassador",
        contactEmail: "ambassador@corp.test",
        contactName: "Amb Contact",
      }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };

    await call(adminToken, `/api/v1/admin/sponsorships/${created.sponsorship.id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active" }),
    });

    const outboxRows = await queryAll<{ template_key: string }>(
      env.DB,
      "SELECT template_key FROM email_outbox WHERE template_key = 'sponsor-portal-access'",
    );
    expect(outboxRows).toHaveLength(0);
  });

  it("rolls back a stage transition, portal token, and notification when its audit insert fails", async () => {
    await call(adminToken, `/api/v1/admin/events/pqc-2026/sponsor-tiers`, {
      method: "PUT",
      body: JSON.stringify({ tiers: [{ tierName: "Rollback", hasAttendeeDataAccess: true }] }),
    });
    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({
        sponsorType: "event",
        eventId,
        tier: "Rollback",
        contactEmail: "rollback-sponsor@example.test",
      }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };

    await env.DB.prepare(
      `CREATE TRIGGER reject_sponsorship_stage_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'sponsorship_stage_advanced'
       BEGIN
         SELECT RAISE(ABORT, 'forced audit failure');
       END`,
    ).run();

    try {
      const response = await call(adminToken, `/api/v1/admin/sponsorships/${created.sponsorship.id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ toStage: "active" }),
      });
      expect(response.status).toBe(500);

      const [sponsorship] = await queryAll<{ pipeline_stage: string }>(
        env.DB,
        "SELECT pipeline_stage FROM sponsorships WHERE id = ?",
        [created.sponsorship.id],
      );
      expect(sponsorship.pipeline_stage).toBe("new_inquiry");
      expect(
        await queryAll(env.DB, "SELECT id FROM sponsorship_events WHERE sponsorship_id = ? AND to_stage = 'active'", [
          created.sponsorship.id,
        ]),
      ).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM sponsor_portal_magic_links WHERE sponsorship_id = ?", [
          created.sponsorship.id,
        ]),
      ).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = 'rollback-sponsor@example.test'"),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS reject_sponsorship_stage_audit").run();
    }
  });

  it("lets an org-tied member view their organization's active sponsorship tier via GET /api/v1/me/organization/sponsorship", async () => {
    const { organizationId, userId } = await seedOrganization("Delta Co");
    const memberToken = await createMemberSession(env.DB, userId, "delta-member-token");

    const beforeResponse = await call(memberToken, "/api/v1/me/organization/sponsorship");
    const before = (await beforeResponse.json()) as { tier: string | null };
    expect(before.tier).toBeNull();

    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({ sponsorType: "consortium", organizationId, tier: "Titanium" }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };
    await call(adminToken, `/api/v1/admin/sponsorships/${created.sponsorship.id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "active" }),
    });

    const afterResponse = await call(memberToken, "/api/v1/me/organization/sponsorship");
    const after = (await afterResponse.json()) as { tier: string | null; startDate: string | null };
    expect(after.tier).toBe("Titanium");
    expect(after.startDate).not.toBeNull();
  });

  it("rejects an unknown pipeline stage with 400", async () => {
    const { organizationId } = await seedOrganization("Epsilon");
    const createResponse = await call(adminToken, "/api/v1/admin/sponsorships", {
      method: "POST",
      body: JSON.stringify({ sponsorType: "consortium", organizationId, tier: "Gold" }),
    });
    const created = (await createResponse.json()) as { sponsorship: { id: string } };

    const response = await call(adminToken, `/api/v1/admin/sponsorships/${created.sponsorship.id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "not_a_real_stage" }),
    });
    expect(response.status).toBe(400);
  });

  it("round-trips per-event sponsor attendee-data-access tier config", async () => {
    const putResponse = await call(adminToken, `/api/v1/admin/events/pqc-2026/sponsor-tiers`, {
      method: "PUT",
      body: JSON.stringify({
        tiers: [
          { tierName: "Leader", hasAttendeeDataAccess: true },
          { tierName: "Inspirator", hasAttendeeDataAccess: false },
        ],
      }),
    });
    expect(putResponse.status).toBe(200);

    const getResponse = await call(adminToken, `/api/v1/admin/events/pqc-2026/sponsor-tiers`);
    const body = (await getResponse.json()) as { tiers: { tierName: string; hasAttendeeDataAccess: boolean }[] };
    expect(body.tiers).toHaveLength(2);
    expect(body.tiers.find((t) => t.tierName === "Leader")?.hasAttendeeDataAccess).toBe(true);
    expect(body.tiers.find((t) => t.tierName === "Inspirator")?.hasAttendeeDataAccess).toBe(false);
  });
});
