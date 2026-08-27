import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createGroupEventInvitationFixture } from "./helpers/group-event-invitations";

async function call(token: string, path: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertInvite(
  eventId: string,
  opts: { email: string; status?: string; createdAt: string; type?: "attendee" | "speaker" },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO invites
       (id, event_id, invitee_email, invite_type, link_secret, status, source_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'direct', ?)`,
  )
    .bind(
      crypto.randomUUID(),
      eventId,
      opts.email,
      opts.type ?? "speaker",
      crypto.randomUUID(),
      opts.status ?? "sent",
      opts.createdAt,
    )
    .run();
}

describe("GET /api/v1/groups/:groupId/events/:eventId/invites/speakers", () => {
  let token: string;
  let eventId: string;
  let basePath: string;

  beforeEach(async () => {
    await resetDb();
    const fixture = await createGroupEventInvitationFixture(env.DB, "speaker-list");
    eventId = fixture.eventId;
    token = fixture.token;
    basePath = `${fixture.basePath}/speakers`;

    await insertInvite(eventId, { email: "a@invite.test", createdAt: "2026-01-01T00:00:00.000Z" });
    await insertInvite(eventId, { email: "b@invite.test", createdAt: "2026-01-02T00:00:00.000Z" });
    await insertInvite(eventId, { email: "c@invite.test", status: "accepted", createdAt: "2026-01-03T00:00:00.000Z" });
    await insertInvite(eventId, {
      email: "attendee@invite.test",
      createdAt: "2026-01-04T00:00:00.000Z",
      type: "attendee",
    });
  });

  it("bounds results with limit/offset via data.query and returns a real page envelope", async () => {
    const response = await call(token, `${basePath}?limit=2&offset=0&sort=created_at`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      invites: Array<{ inviteeEmail: string; inviteType: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(body.invites).toHaveLength(2);
    expect(body.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });
    expect(body.invites.every((invite) => invite.inviteType === "speaker")).toBe(true);
  });

  it("filters by status", async () => {
    const response = await call(token, `${basePath}?status=accepted`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { invites: Array<{ inviteeEmail: string }>; page: { total: number } };
    expect(body.invites.map((i) => i.inviteeEmail)).toEqual(["c@invite.test"]);
    expect(body.page.total).toBe(1);
  });

  it("rejects an invalid limit", async () => {
    const response = await call(token, `${basePath}?limit=0`);
    expect(response.status).toBe(400);
  });

  it("rejects unknown filters instead of silently returning unfiltered data", async () => {
    const response = await call(token, `${basePath}?status=unexpected`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
