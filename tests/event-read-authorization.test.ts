import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { computeGrantsForUser } from "../functions/_lib/auth/permissions";
import { listVisibleEvents } from "../functions/_lib/services/events/catalog";
import type { DatabaseLike, UserBackedAuthAdmin } from "../functions/_lib/types";
import { eventsListResponseSchema } from "../assets/shared/schemas/event-management";
import { groupEventsListResponseSchema } from "../assets/shared/schemas/group-events";
import { createGroupEventInvitationFixture } from "./helpers/group-event-invitations";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";
import { seedPersona } from "./personas/seed";

async function fixture() {
  const event = await createGroupEventInvitationFixture(env.DB, "live-read");
  await env.DB.prepare("UPDATE events SET visibility = 'invitation_only' WHERE id = ?").bind(event.eventId).run();
  const reader = await seedPersona(env.DB, "groupParticipant", {
    groupId: event.groupId,
    joinGroupWithCapacities: true,
  });
  const grantId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO permission_grants (id, user_id, permission, created_at) VALUES (?, ?, 'events:read', ?)",
  )
    .bind(grantId, reader.userId, new Date().toISOString())
    .run();
  return { ...event, reader, grantId };
}

async function request(path: string, token: string | null, db: DatabaseLike = env.DB) {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
    { ...env, DB: db as typeof env.DB },
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  );
}

function beforeEventRead(mutation: () => Promise<unknown>) {
  return mutateBeforeMatchingQuery(env.DB, (sql) => /(?:FROM|JOIN) events event\b/.test(sql), mutation);
}

describe("live event-read authorization", () => {
  beforeEach(resetDb);

  it.each(["revoke", "expire", "disable"] as const)(
    "rejects a management list when authority changes after authentication: %s",
    async (change) => {
      const { reader, grantId, eventSlug } = await fixture();
      const path = `/api/v1/events?q=${eventSlug}`;
      const control = await request(path, reader.token);
      expect(control.status).toBe(200);
      expect(eventsListResponseSchema.parse(await control.json()).events).toHaveLength(1);
      const db = beforeEventRead(async () => {
        if (change === "disable") {
          await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(reader.userId).run();
        } else {
          await env.DB.prepare(
            `UPDATE permission_grants SET ${change === "revoke" ? "revoked_at" : "expires_at"} = '2000-01-01T00:00:00.000Z' WHERE id = ?`,
          )
            .bind(grantId)
            .run();
        }
      });
      expect((await request(path, reader.token, db)).status).toBe(403);
    },
  );

  it("rejects management statistics when permission is revoked after page selection", async () => {
    const { reader, grantId } = await fixture();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("registration_counts AS"),
      async () => {
        await env.DB.prepare("UPDATE permission_grants SET revoked_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), grantId)
          .run();
      },
    );
    expect((await request("/api/v1/events", reader.token, db)).status).toBe(403);
  });

  it.each(["invitation_only", "public"] as const)(
    "protects management detail even when ordinary audience access remains: %s",
    async (visibility) => {
      const { reader, grantId, eventId, eventSlug } = await fixture();
      await env.DB.prepare("UPDATE events SET visibility = ? WHERE id = ?").bind(visibility, eventId).run();
      const path = `/api/v1/events/${eventSlug}`;
      expect((await request(path, reader.token)).status).toBe(200);
      const db = beforeEventRead(async () => {
        await env.DB.prepare("UPDATE permission_grants SET revoked_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), grantId)
          .run();
      });
      expect((await request(path, reader.token, db)).status).toBe(403);
    },
  );

  it("removes a private event from a group list after direct read revocation", async () => {
    const { reader, grantId, groupId } = await fixture();
    const path = `/api/v1/groups/${groupId}/events`;
    const control = await request(path, reader.token);
    expect(control.status).toBe(200);
    expect(groupEventsListResponseSchema.parse(await control.json()).events).toHaveLength(1);
    const db = beforeEventRead(async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), grantId)
        .run();
    });
    const response = await request(path, reader.token, db);
    expect(response.status).toBe(200);
    expect(groupEventsListResponseSchema.parse(await response.json()).events).toEqual([]);
  });

  it.each(["assignment", "bundle"] as const)("rejects group detail after role %s revocation", async (change) => {
    const { reader, grantId, groupId, eventId } = await fixture();
    await env.DB.prepare("DELETE FROM permission_grants WHERE id = ?").bind(grantId).run();
    const roleId = crypto.randomUUID();
    const assignmentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO roles (id, name, description, created_at, updated_at) VALUES (?, ?, 'Read fixture', ?, ?)",
      ).bind(roleId, roleId, new Date().toISOString(), new Date().toISOString()),
      env.DB.prepare(
        "INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES (?, ?, 'events:read', ?)",
      ).bind(crypto.randomUUID(), roleId, new Date().toISOString()),
      env.DB.prepare("INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)").bind(
        assignmentId,
        reader.userId,
        roleId,
        new Date().toISOString(),
      ),
    ]);
    const path = `/api/v1/groups/${groupId}/events/${eventId}`;
    expect((await request(path, reader.token)).status).toBe(200);
    const db = beforeEventRead(async () => {
      if (change === "assignment") {
        await env.DB.prepare("UPDATE user_roles SET revoked_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), assignmentId)
          .run();
      } else {
        await env.DB.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission = 'events:read'")
          .bind(roleId)
          .run();
      }
    });
    expect((await request(path, reader.token, db)).status).toBe(404);
  });

  it("preserves independent live group management after event-read revocation", async () => {
    const { reader, grantId, groupId, eventId } = await fixture();
    await env.DB.prepare(
      "INSERT INTO permission_grants (id, user_id, permission, created_at) VALUES (?, ?, 'groups:write', ?)",
    )
      .bind(crypto.randomUUID(), reader.userId, new Date().toISOString())
      .run();
    const db = beforeEventRead(async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), grantId)
        .run();
    });
    expect((await request(`/api/v1/groups/${groupId}/events/${eventId}`, reader.token, db)).status).toBe(200);
  });

  it("enforces scope ceilings in audience SQL and preserves explicit service authority", async () => {
    const { reader, eventSlug } = await fixture();
    const admin: UserBackedAuthAdmin = {
      identityType: "user",
      id: reader.userId,
      email: reader.email,
      grants: await computeGrantsForUser(env.DB, reader.userId),
      scopeRestricted: true,
      scopes: [],
    };
    const query = { limit: 10, offset: 0, q: eventSlug };
    expect((await listVisibleEvents(env.DB, { userId: reader.userId, admin }, query)).events).toEqual([]);
    expect(
      (
        await listVisibleEvents(
          env.DB,
          {
            userId: null,
            admin: { identityType: "service", id: "test-api-key", email: "service@example.test", role: "admin" },
          },
          query,
        )
      ).events,
    ).toHaveLength(1);
  });
});
