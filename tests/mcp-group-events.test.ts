import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { createMcpOauthTestClient } from "./helpers/mcp-oauth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { groupEventCreateSchema } from "../assets/shared/schemas/group-events";
import { verifyUserSessionToken } from "../functions/_lib/auth/user-session-token";
import { signMcpSessionToken } from "../functions/_lib/auth/mcp-session";
import { requireUserBackedAdminFromRequest } from "../functions/_lib/auth/admin";
import { updateGroupManagedEventSettings } from "../functions/_lib/services/events/group-management";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

const env = { ...workerEnv, INTERNAL_SIGNING_SECRET: "synthetic-oauth-test-signing-secret-32-plus" };
const { call, callTool, authorize, initialize } = createMcpOauthTestClient(env);

function value(result: { content: { type: string; text?: string }[] }) {
  return JSON.parse(result.content.find((item) => item.type === "text")!.text!);
}

async function groupFixture() {
  const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email='admin@pkic.org'");
  const token = await createAdminSession(env.DB, user.id, crypto.randomUUID(), env.INTERNAL_SIGNING_SECRET);
  const groups = [];
  for (const name of ["Approved group", "Other group"]) {
    const response = await call("/api/v1/groups", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ typeKey: "working_group", name, visibility: "authenticated", eligibilityMode: "open" }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    groups.push(((await response.json()) as { group: { id: string } }).group.id);
  }
  return { userId: user.id, token, approved: groups[0], other: groups[1] };
}

function eventInput() {
  return groupEventCreateSchema.parse({
    slug: `mcp-event-${crypto.randomUUID()}`,
    name: "Synthetic MCP conference",
    timezone: "America/Toronto",
    startsAt: "2031-06-02T14:00:00.000Z",
    endsAt: "2031-06-04T22:00:00.000Z",
    profileKey: "workshop",
    registrationPolicy: "no_registration",
    inviteLimitAttendee: 0,
    city: "Toronto",
    country: "CA",
    links: [],
  });
}

async function mcpCreate(token: string, groupId: string) {
  return value(
    await callTool(token, "request", { method: "POST", path: `/api/v1/groups/${groupId}/events`, body: eventInput() }),
  );
}

describe("group event operations through delegated MCP", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  it("creates and updates a group event through the existing API", async () => {
    const fixture = await groupFixture();
    const grant = await authorize(fixture.token, ["groups:write"]);
    const created = await mcpCreate(grant.access_token, fixture.approved);
    expect(created.error).toBeUndefined();
    expect(created.event).toMatchObject({ city: "Toronto", timezone: "America/Toronto" });
    const updated = value(
      await callTool(grant.access_token, "request", {
        method: "PATCH",
        path: `/api/v1/groups/${fixture.approved}/events/${created.event.id}/settings`,
        body: {
          expectedUpdatedAt: created.event.updatedAt,
          venue: "Synthetic North Building, 100 Level",
          city: "Toronto updated",
        },
      }),
    );
    expect(updated.error).toBeUndefined();
    expect(updated.event.city).toBe("Toronto updated");
    const [stored] = await queryAll<{ venue: string }>(
      env.DB,
      "SELECT json_extract(settings_json,'$.venue') AS venue FROM events WHERE id=?",
      created.event.id,
    );
    expect(stored.venue).toBe("Synthetic North Building, 100 Level");
  });

  it("does not turn read-only consent into group management", async () => {
    const fixture = await groupFixture();
    const grant = await authorize(fixture.token, ["groups:read"]);
    const refused = await mcpCreate(grant.access_token, fixture.approved);
    expect(refused.error.code).toBe("GROUP_MANAGEMENT_REQUIRED");
    const [count] = await queryAll<{ count: number }>(
      env.DB,
      "SELECT COUNT(*) AS count FROM events WHERE owner_group_id=?",
      fixture.approved,
    );
    expect(count.count).toBe(0);
  });

  it("keeps the approved group boundary when live permissions later become global", async () => {
    const fixture = await groupFixture();
    await env.DB.prepare("DELETE FROM user_roles WHERE role_id='role-admin' AND user_id=?").bind(fixture.userId).run();
    await env.DB.prepare(
      "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,'groups:write','group',?,?)",
    )
      .bind(crypto.randomUUID(), fixture.userId, fixture.approved, new Date().toISOString())
      .run();
    const grant = await authorize(fixture.token, ["groups:write"]);
    await env.DB.prepare(
      "INSERT INTO permission_grants (id,user_id,permission,created_at) VALUES (?,?,'groups:write',?)",
    )
      .bind(crypto.randomUUID(), fixture.userId, new Date().toISOString())
      .run();
    await env.DB.prepare("UPDATE groups SET parent_group_id=?, governance_inheritance_mode='inherited' WHERE id=?")
      .bind(fixture.approved, fixture.other)
      .run();
    expect((await mcpCreate(grant.access_token, fixture.approved)).event).toBeDefined();
    expect((await mcpCreate(grant.access_token, fixture.other)).error.code).toBe("GROUP_PERMISSION_REQUIRED");
    const listed = value(
      await callTool(grant.access_token, "request", {
        method: "GET",
        path: "/api/v1/groups",
        query: { manageable: true },
      }),
    );
    expect(listed.groups.map((group: { id: string }) => group.id)).toEqual([fixture.approved]);
    await env.DB.prepare("UPDATE oauth_authorizations SET status='revoked' WHERE id=?")
      .bind(grant.authorizationId)
      .run();
    expect((await initialize(grant.access_token)).status).toBe(401);
  });

  it.each(["groups:read", "groups:write"] as const)(
    "preserves inherited child visibility within %s consent",
    async (permission) => {
      const fixture = await groupFixture();
      await env.DB.prepare("UPDATE groups SET parent_group_id=?, governance_inheritance_mode='inherited' WHERE id=?")
        .bind(fixture.approved, fixture.other)
        .run();
      await env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(fixture.userId).run();
      const leadership = await grantGroupLeadershipCapacity(env.DB, fixture.approved, fixture.userId);
      const leaderToken = await createAdminSession(
        env.DB,
        fixture.userId,
        crypto.randomUUID(),
        env.INTERNAL_SIGNING_SECRET,
        leadership.identityId,
      );
      const grantId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,?,'group',?,?)",
      )
        .bind(grantId, fixture.userId, permission, fixture.other, new Date().toISOString())
        .run();
      const grant = await authorize(leaderToken, [permission], leadership.identityId);
      await env.DB.prepare("DELETE FROM permission_grants WHERE id=?").bind(grantId).run();
      const detail = value(
        await callTool(grant.access_token, "request", { method: "GET", path: `/api/v1/groups/${fixture.other}` }),
      );
      expect(detail.error).toBeUndefined();
      expect(detail.group.id).toBe(fixture.other);
      const listed = value(await callTool(grant.access_token, "request", { method: "GET", path: "/api/v1/groups" }));
      expect(listed.groups.map((group: { id: string }) => group.id)).toContain(fixture.other);
    },
  );

  it.each(["authorization", "expiry", "session", "permission"])(
    "rolls back an event update when %s changes before commit",
    async (reason) => {
      const fixture = await groupFixture();
      const grant = await authorize(fixture.token, ["groups:write"]);
      const created = await mcpCreate(grant.access_token, fixture.approved);
      const verified = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET, fixture.token);
      if (!verified.ok) throw new Error("Expected valid synthetic user session");
      const token = await signMcpSessionToken(env.INTERNAL_SIGNING_SECRET, {
        sub: fixture.userId,
        sid: verified.claims.sid,
        email: "admin@pkic.org",
        scopes: ["groups:write"],
        exp: verified.claims.exp,
        authorizationId: grant.authorizationId,
      });
      const actor = await requireUserBackedAdminFromRequest(
        env.DB,
        new Request("https://app.test/api/v1/groups", {
          headers: { authorization: `Bearer ${token}`, "x-pkic-machine-auth": "mcp" },
        }),
        env,
      );
      const guarded = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("INSERT INTO event_resource_management_guards"),
        async () => {
          if (reason === "authorization")
            await env.DB.prepare("UPDATE oauth_authorizations SET status='revoked' WHERE id=?")
              .bind(grant.authorizationId)
              .run();
          if (reason === "expiry")
            await env.DB.prepare("UPDATE oauth_authorizations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
              .bind(grant.authorizationId)
              .run();
          if (reason === "session")
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?")
              .bind(new Date().toISOString(), verified.claims.sid)
              .run();
          if (reason === "permission")
            await env.DB.prepare(
              "DELETE FROM role_permissions WHERE role_id='role-admin' AND permission='groups:write'",
            ).run();
        },
      );
      await expect(
        updateGroupManagedEventSettings(
          guarded,
          actor,
          fixture.approved,
          created.event.id,
          { expectedUpdatedAt: created.event.updatedAt, city: "Must roll back" },
          "https://app.test",
        ),
      ).rejects.toMatchObject({ code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });
      const [stored] = await queryAll<{ city: string }>(env.DB, "SELECT city FROM events WHERE id=?", created.event.id);
      expect(stored.city).toBe("Toronto");
    },
  );
});
