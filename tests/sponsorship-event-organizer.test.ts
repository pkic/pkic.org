/**
 * An event's organizers (`events:write` on that event) book and manage the
 * event's one-time sponsors without the global sponsorship permissions.
 * Consortium sponsorships, other events and payment settlements stay with staff.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });
const futureDate = () => new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);

describe("Event organizers and event sponsors", () => {
  let adminToken: string;
  let adminId: string;
  let eventA: string;
  let eventB: string;
  let chairId: string;
  let chair: string;

  async function grantEventWrite(userId: string, eventId: string): Promise<string> {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'events:write', 'event', ?, ?, datetime('now'))`,
    )
      .bind(id, userId, eventId, adminId)
      .run();
    return id;
  }

  async function staffSponsorship(body: Record<string, unknown>): Promise<string> {
    const response = await call(adminToken, "/api/v1/sponsors", json(body));
    expect(response.status, await response.clone().text()).toBe(201);
    return ((await response.json()) as { sponsorship: { id: string } }).sponsorship.id;
  }

  beforeEach(async () => {
    await resetDb();
    ({ eventId: eventA } = await seedEventAndAdmin(env.DB));
    adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0].id;
    adminToken = await createAdminSession(env.DB, adminId, "organizer-admin-token");
    eventB = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, source_path, capacity_in_person, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
       VALUES (?, 'other-2026', 'Other Event 2026', 'Europe/Amsterdam', '2026-12-01T08:00:00.000Z', '2026-12-03T18:00:00.000Z',
       'content/events/2026/other/_index.md', 1, 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
    )
      .bind(eventB)
      .run();
    chairId = await insertUser(env.DB, `chair-${crypto.randomUUID()}@example.test`);
    await grantEventWrite(chairId, eventA);
    chair = await createAdminSession(env.DB, chairId, "organizer-chair-token");
  });

  it("creates, reads, corrects, activates and lists an event sponsor for their own event", async () => {
    const created = await call(
      chair,
      "/api/v1/sponsors",
      json({ sponsorType: "event", eventId: eventA, nonMemberName: "Synthetic Sponsor", tier: "Leader" }),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const id = ((await created.json()) as { sponsorship: { id: string } }).sponsorship.id;

    expect((await call(chair, `/api/v1/sponsors/${id}`)).status).toBe(200);
    const updated = await call(
      chair,
      `/api/v1/sponsors/${id}`,
      patch({ notes: "Booked by the chair", renewalDate: futureDate() }),
    );
    expect(updated.status, await updated.clone().text()).toBe(200);

    const staged = await call(chair, `/api/v1/sponsors/${id}/stage`, patch({ toStage: "active" }));
    expect(staged.status, await staged.clone().text()).toBe(200);
    expect(((await staged.json()) as { sponsorship: { pipelineStage: string } }).sponsorship.pipelineStage).toBe(
      "active",
    );

    const other = await staffSponsorship({
      sponsorType: "event",
      eventId: eventB,
      nonMemberName: "Other Event Sponsor",
    });
    const listed = await call(chair, `/api/v1/sponsors?visibility=all&eventId=${eventA}`);
    expect(listed.status, await listed.clone().text()).toBe(200);
    const rows = ((await listed.json()) as { sponsorships: { id: string }[] }).sponsorships;
    expect(rows.map((row) => row.id)).toEqual([id]);
    expect(rows.map((row) => row.id)).not.toContain(other);
  });

  it("uploads and removes the logo of an event sponsor for their own event", async () => {
    const created = await call(
      chair,
      "/api/v1/sponsors",
      json({ sponsorType: "event", eventId: eventA, nonMemberName: "Synthetic Sponsor", tier: "Leader" }),
    );
    const id = ((await created.json()) as { sponsorship: { id: string } }).sponsorship.id;
    const body = new FormData();
    body.append(
      "file",
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="60" height="60" fill="#175"/></svg>',
        ],
        "logo.svg",
        {
          type: "image/svg+xml",
        },
      ),
    );
    const uploaded = await call(chair, `/api/v1/sponsors/${id}/logo`, { method: "PUT", body });
    expect(uploaded.status, await uploaded.clone().text()).toBe(200);
    const removed = await call(chair, `/api/v1/sponsors/${id}/logo`, { method: "DELETE" });
    expect(removed.status, await removed.clone().text()).toBe(200);
  });

  it("refuses an organizer another event, the unfiltered list, and an unfiltered consortium list", async () => {
    expect(
      (await call(chair, "/api/v1/sponsors", json({ sponsorType: "event", eventId: eventB, nonMemberName: "Nope" })))
        .status,
    ).toBe(403);
    expect((await call(chair, "/api/v1/sponsors?visibility=all")).status).toBe(403);
    expect((await call(chair, `/api/v1/sponsors?visibility=all&eventId=${eventB}`)).status).toBe(403);

    const otherId = await staffSponsorship({
      sponsorType: "event",
      eventId: eventB,
      nonMemberName: "Other Event Sponsor",
    });
    expect((await call(chair, `/api/v1/sponsors/${otherId}`)).status).toBe(403);
    expect((await call(chair, `/api/v1/sponsors/${otherId}`, patch({ notes: "x" }))).status).toBe(403);
    expect((await call(chair, `/api/v1/sponsors/${otherId}/stage`, patch({ toStage: "contacted" }))).status).toBe(403);
    expect((await call(chair, `/api/v1/sponsors/${crypto.randomUUID()}`)).status).toBe(403);
  });

  it("refuses an organizer consortium sponsorships, even when listing the event", async () => {
    const orgId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, 'Synthetic Org', 'synthetic org', datetime('now'), datetime('now'))`,
    )
      .bind(orgId)
      .run();
    expect(
      (await call(chair, "/api/v1/sponsors", json({ sponsorType: "consortium", organizationId: orgId }))).status,
    ).toBe(403);
    const consortiumId = await staffSponsorship({ sponsorType: "consortium", organizationId: orgId, tier: "Gold" });
    expect((await call(chair, `/api/v1/sponsors/${consortiumId}`)).status).toBe(403);
    expect((await call(chair, `/api/v1/sponsors/${consortiumId}`, patch({ notes: "x" }))).status).toBe(403);
    expect((await call(chair, `/api/v1/sponsors/${consortiumId}/stage`, patch({ toStage: "contacted" }))).status).toBe(
      403,
    );

    const listed = await call(chair, `/api/v1/sponsors?visibility=all&eventId=${eventA}&type=consortium`);
    expect(((await listed.json()) as { sponsorships: unknown[] }).sponsorships).toEqual([]);
  });

  it("keeps assignment, event, type and payment settlements with staff", async () => {
    expect(
      (
        await call(
          chair,
          "/api/v1/sponsors",
          json({ sponsorType: "event", eventId: eventA, nonMemberName: "Assigned", assignedToUserId: adminId }),
        )
      ).status,
    ).toBe(403);
    const id = await staffSponsorship({ sponsorType: "event", eventId: eventA, nonMemberName: "Staff Booked" });
    expect((await call(chair, `/api/v1/sponsors/${id}`, patch({ assignedToUserId: adminId }))).status).toBe(403);

    // Type and event are not part of the update contract; a chair sending them changes nothing.
    await call(chair, `/api/v1/sponsors/${id}`, patch({ notes: "kept", eventId: eventB, sponsorType: "consortium" }));
    expect(
      await env.DB.prepare("SELECT sponsor_type, event_id, notes FROM sponsorships WHERE id = ?").bind(id).first(),
    ).toEqual({ sponsor_type: "event", event_id: eventA, notes: "kept" });

    const settlement = await call(
      chair,
      `/api/v1/sponsors/${id}/settlements`,
      json({
        idempotencyKey: crypto.randomUUID(),
        amount: 50000,
        currency: "eur",
        method: "bank_transfer",
        settledAt: new Date().toISOString(),
        reference: "SYNTHETIC-1",
        note: "Synthetic settlement.",
      }),
    );
    expect(settlement.status).toBe(403);
  });

  it("stops an organizer whose event grant is revoked", async () => {
    const id = await staffSponsorship({ sponsorType: "event", eventId: eventA, nonMemberName: "Staff Booked" });
    await env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ?")
      .bind(chairId)
      .run();
    expect((await call(chair, `/api/v1/sponsors/${id}`)).status).toBe(403);
    expect((await call(chair, `/api/v1/sponsors/${id}`, patch({ notes: "x" }))).status).toBe(403);
  });

  it("leaves staff access unchanged", async () => {
    const id = await staffSponsorship({ sponsorType: "event", eventId: eventB, nonMemberName: "Staff Booked" });
    expect((await call(adminToken, `/api/v1/sponsors/${id}`)).status).toBe(200);
    expect((await call(adminToken, `/api/v1/sponsors/${id}`, patch({ assignedToUserId: adminId }))).status).toBe(200);
    const all = await call(adminToken, "/api/v1/sponsors?visibility=all");
    expect(((await all.json()) as { sponsorships: unknown[] }).sponsorships).toHaveLength(1);
    const filtered = await call(adminToken, `/api/v1/sponsors?visibility=all&eventId=${eventA}`);
    expect(((await filtered.json()) as { sponsorships: unknown[] }).sponsorships).toHaveLength(0);
  });
});
