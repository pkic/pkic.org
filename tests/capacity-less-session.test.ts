import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { createTestRateLimiter, deliveredEmailPayload, queryAll } from "./helpers/context";
import { requireMembershipCategory } from "../functions/_lib/services/membership/categories";
import {
  prepareMembershipWorkflowPin,
  requireCategoryWorkflow,
} from "../functions/_lib/services/membership/workflows/pinning";
import { seedMemberApplication } from "./helpers/member-applications";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const EMAIL = "no-capacity@example.test";
let emailRateLimiter: ReturnType<typeof createTestRateLimiter>;
let ipRateLimiter: ReturnType<typeof createTestRateLimiter>;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    { ...env, EMAIL_RATE_LIMITER: emailRateLimiter, IP_RATE_LIMITER: ipRateLimiter } as never,
    { passThroughOnException() {}, waitUntil() {} } as never,
  );
}

async function signIn(email: string) {
  const requested = await call("/api/v1/auth/request-link", { method: "POST", body: JSON.stringify({ email }) });
  expect(requested.status).toBe(200);
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key='user_magic_link' ORDER BY rowid DESC LIMIT 1",
  );
  if (!outbox) throw new Error("Expected a sign-in email for a user with no capacity");
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
  const token = new URLSearchParams(new URL(delivered.magicLinkUrl).hash.split("?", 2)[1]).get("token");
  const verified = await call("/api/v1/auth/verify-link", { method: "POST", body: JSON.stringify({ token }) });
  expect(verified.status).toBe(200);
  return {
    session: userAuthSessionResponseSchema.parse(await verified.json()),
    headers: { cookie: (verified.headers.get("set-cookie") ?? "").split(";", 1)[0] },
  };
}

async function insertGroup(slug: string, visibility: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, visibility, active, created_at, updated_at)
     VALUES (?, 'working_group', ?, ?, ?, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, slug, slug, visibility)
    .run();
  return id;
}

describe("a user with no capacity", () => {
  let userId: string;
  let headers: { cookie: string };

  beforeEach(async () => {
    await resetDb();
    emailRateLimiter = createTestRateLimiter(20);
    ipRateLimiter = createTestRateLimiter(20);
    userId = await insertUser(env.DB, EMAIL);
    const signedIn = await signIn(EMAIL);
    headers = signedIn.headers;
    expect(signedIn.session).toMatchObject({ identity: { id: userId }, sponsors: [], pendingIdentityCount: 0 });
    expect(signedIn.session.member).toBeUndefined();
    expect(signedIn.session.staff).toBeUndefined();
  });

  it("keeps a live session, refreshed from the session endpoint", async () => {
    const refreshed = await call("/api/v1/auth/session", { headers });
    expect(refreshed.status).toBe(200);
    expect(userAuthSessionResponseSchema.parse(await refreshed.json()).identity.id).toBe(userId);
  });

  it("reads its own user, addresses and past identities", async () => {
    for (const path of [
      `/api/v1/users/${userId}`,
      "/api/v1/users/current/emails",
      "/api/v1/users/current/identities",
    ]) {
      expect((await call(path, { headers })).status, path).toBe(200);
    }
  });

  it("reads and edits its own profile, notification choices and passkeys", async () => {
    const profile = await call("/api/v1/users/current", { headers });
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      userId,
      identityId: null,
      membershipCategory: null,
      activeIdentities: [],
    });
    const json = { ...headers, "content-type": "application/json" };
    const patched = await call("/api/v1/users/current", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ firstName: "Alexa", preferredName: "Lexi" }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ firstName: "Alexa", preferredName: "Lexi" });
    const identityFields = await call("/api/v1/users/current", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ biography: "Not mine to set without an identity" }),
    });
    expect(identityFields.status).toBe(422);

    expect((await call("/api/v1/users/current/notifications/preferences", { headers })).status).toBe(200);
    const preferences = await call("/api/v1/users/current/notifications/preferences", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ voteReminders: false }),
    });
    expect(preferences.status).toBe(200);
    expect(await preferences.json()).toMatchObject({ voteReminders: false });

    expect((await call("/api/v1/auth/passkeys", { headers })).status).toBe(200);
    const begin = await call("/api/v1/auth/passkeys/register/begin", { method: "POST", headers });
    expect(begin.status).toBe(200);
    expect(await begin.json()).toHaveProperty("options");
  });

  it("is refused member, group, event, organization and staff routes", async () => {
    const otherUser = await insertUser(env.DB, "unrelated@example.test");
    const groupId = await insertGroup("closed-group", "participants");
    const refused = [
      "/api/v1/users/current/votes",
      "/api/v1/users/current/forms",
      "/api/v1/users/current/meetings",
      `/api/v1/users/${otherUser}`,
      "/api/v1/users",
      "/api/v1/organizations",
      "/api/v1/members/applications",
      `/api/v1/groups/${groupId}/memberships`,
    ];
    for (const path of refused) {
      const status = (await call(path, { headers })).status;
      expect([401, 403, 404], `${path} answered ${status}`).toContain(status);
    }
  });

  it("does not see groups that are visible only to signed-in people", async () => {
    await insertGroup("public-group", "public");
    await insertGroup("signed-in-group", "authenticated");
    const response = await call("/api/v1/groups", { headers });
    expect(response.status).toBe(200);
    const slugs = ((await response.json()) as { groups: Array<{ slug: string }> }).groups.map((group) => group.slug);
    expect(slugs).toContain("public-group");
    expect(slugs).not.toContain("signed-in-group");
  });

  it("is refused a personal agenda for an event it cannot see", async () => {
    const eventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, visibility, registration_mode, settings_json, created_at, updated_at)
       VALUES (?, 'members-only', 'Members only', 'UTC', 'all_members', 'invite_or_open', '{}', datetime('now'), datetime('now'))`,
    )
      .bind(eventId)
      .run();
    const status = (await call("/api/v1/events/members-only/agenda/participation", { headers })).status;
    expect([403, 404]).toContain(status);
  });

  it("no longer reads an application review it once objected to", async () => {
    const applicationId = await seedMemberApplication({
      applicantEmail: "applicant@example.test",
      stage: "processing",
    });
    const category = await requireMembershipCategory(env.DB, "F");
    await env.DB.batch(
      prepareMembershipWorkflowPin(
        env.DB,
        applicationId,
        category,
        await requireCategoryWorkflow(env.DB, category),
        1,
        new Date().toISOString(),
      ),
    );
    await env.DB.prepare(
      `INSERT INTO membership_application_objections
         (id, application_id, generation, step_position, author_user_id, body, state, created_at)
       VALUES (?, ?, 1, 1, ?, 'A concern.', 'unresolved', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), applicationId, userId)
      .run();
    for (const path of [
      `/api/v1/members/applications/${applicationId}/reviews/current`,
      `/api/v1/members/applications/${applicationId}/objections`,
    ]) {
      expect((await call(path, { headers })).status, path).toBe(403);
    }
  });

  it("loses the session when the user is deactivated", async () => {
    await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(userId).run();
    expect((await call("/api/v1/auth/session", { headers })).status).toBe(401);
  });
});
