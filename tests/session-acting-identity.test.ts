/**
 * Which identity a user session acts as, and the audit records it leaves.
 *
 * A person with one active identity acts as it without being asked; a person
 * with several acts as none until they choose, and a choice holds only while
 * that identity stays active. The choice is made through the active-identity
 * endpoint, which reissues the session, and every audit row the session writes
 * names the identity it acted as.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { verifyUserSessionToken } from "../functions/_lib/auth/user-session";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { auditLogListResponseSchema } from "../assets/shared/schemas/audit-log";

const SIGNING_SECRET = "test-signing-secret";

function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
}

async function currentSession(token: string) {
  const response = await call(token, "/api/v1/auth/session");
  expect(response.status).toBe(200);
  return userAuthSessionResponseSchema.parse(await response.json());
}

async function selectIdentity(token: string, identityId: string): Promise<Response> {
  return call(token, "/api/v1/users/current/identities/active", {
    method: "PUT",
    body: JSON.stringify({ identityId }),
  });
}

async function claimedIdentity(token: string): Promise<string | undefined> {
  const verified = await verifyUserSessionToken(SIGNING_SECRET, token);
  if (!verified.ok) throw new Error("reissued session token did not verify");
  return verified.claims.iid;
}

async function personWithOrganizations(names: string[]) {
  const userId = await insertUser(env.DB);
  const identityIds: string[] = [];
  for (const name of names) {
    const organizationId = await insertOrganization(env.DB, name);
    const memberId = await seedOrganizationAggregate(env.DB, organizationId);
    identityIds.push(await addRepresentative(env.DB, memberId, userId, { jobTitle: `${name} delegate` }));
  }
  return { userId, identityIds };
}

async function endIdentity(identityId: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE identities SET ended_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, identityId)
    .run();
}

async function updateFirstName(token: string, firstName: string): Promise<void> {
  const response = await call(token, "/api/v1/users/current", {
    method: "PATCH",
    body: JSON.stringify({ firstName }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

async function profileUpdateIdentities(userId: string): Promise<Array<string | null>> {
  const rows = await queryAll<{ actor_identity_id: string | null }>(
    env.DB,
    `SELECT actor_identity_id FROM audit_log
      WHERE action = 'user_profile_updated' AND actor_id = ?
      ORDER BY created_at, rowid`,
    [userId],
  );
  return rows.map((row) => row.actor_identity_id);
}

async function signInWithLink(email: string): Promise<string> {
  expect(
    (await call(null, "/api/v1/auth/request-link", { method: "POST", body: JSON.stringify({ email }) })).status,
  ).toBe(200);
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
  );
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
  const capability = new URLSearchParams(new URL(delivered.magicLinkUrl).hash.split("?", 2)[1]).get("token");
  const verified = await call(null, "/api/v1/auth/verify-link", {
    method: "POST",
    body: JSON.stringify({ token: capability }),
    headers: { "cf-connecting-ip": "203.0.113.40" },
  });
  expect(verified.status).toBe(200);
  const cookie = (verified.headers.get("set-cookie") ?? "").split(";", 1)[0];
  return decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
}

describe("session acting identity", () => {
  beforeEach(resetDb);

  it("acts as a person's only identity without asking", async () => {
    const { userId, identityIds } = await personWithOrganizations(["Solo Org"]);
    const token = await createMemberSession(env.DB, userId, "solo", undefined, null);

    const session = await currentSession(token);
    expect(session.actingIdentities).toEqual([
      {
        id: identityIds[0],
        organizationId: expect.any(String),
        organizationName: "Solo Org",
        jobTitle: "Solo Org delegate",
      },
    ]);
    expect(session.actingIdentityId).toBe(identityIds[0]);

    await updateFirstName(token, "Solo");
    expect(await profileUpdateIdentities(userId)).toEqual([identityIds[0]]);
  });

  it("requires a choice from a person with several identities, and records none until it is made", async () => {
    const { userId, identityIds } = await personWithOrganizations(["Alpha Org", "Beta Org"]);
    const token = await createMemberSession(env.DB, userId, "several", undefined, null);

    const session = await currentSession(token);
    expect(session.actingIdentities.map((identity) => identity.organizationName)).toEqual(["Alpha Org", "Beta Org"]);
    expect(session.actingIdentityId).toBeNull();

    await updateFirstName(token, "Undecided");
    expect(await profileUpdateIdentities(userId)).toEqual([null]);

    const chosen = await selectIdentity(token, identityIds[1]);
    expect(chosen.status).toBe(200);
    expect(userAuthSessionResponseSchema.parse(await chosen.json()).actingIdentityId).toBe(identityIds[1]);
    const reissued = chosen.headers.get("x-user-token");
    if (!reissued) throw new Error("the active-identity endpoint did not reissue the session");
    expect(await claimedIdentity(reissued)).toBe(identityIds[1]);
    expect((await currentSession(reissued)).actingIdentityId).toBe(identityIds[1]);

    await updateFirstName(reissued, "Decided");
    expect(await profileUpdateIdentities(userId)).toEqual([null, identityIds[1]]);
  });

  it("honors a selection only while the selected identity stays active", async () => {
    const { userId, identityIds } = await personWithOrganizations(["Alpha Org", "Beta Org", "Gamma Org"]);
    const token = await createMemberSession(env.DB, userId, "stale", undefined, identityIds[0]);
    expect((await currentSession(token)).actingIdentityId).toBe(identityIds[0]);

    await endIdentity(identityIds[0]);
    // Two identities remain and neither was chosen.
    expect((await currentSession(token)).actingIdentityId).toBeNull();

    await endIdentity(identityIds[1]);
    // The only remaining identity needs no choice.
    expect((await currentSession(token)).actingIdentityId).toBe(identityIds[2]);
  });

  it("refuses an identity the caller does not actively hold", async () => {
    const { userId, identityIds } = await personWithOrganizations(["Alpha Org", "Beta Org"]);
    const stranger = await personWithOrganizations(["Stranger Org"]);
    const token = await createMemberSession(env.DB, userId, "refusal", undefined, null);

    const foreign = await selectIdentity(token, stranger.identityIds[0]);
    expect(foreign.status).toBe(403);
    await expect(foreign.json()).resolves.toMatchObject({ error: { code: "NOT_ACTIVE_IDENTITY" } });
    expect(foreign.headers.get("x-user-token")).toBeNull();

    await endIdentity(identityIds[0]);
    expect((await selectIdentity(token, identityIds[0])).status).toBe(403);
  });

  it("selects silently at sign-in only for a person with one identity", async () => {
    await seedEventAndAdmin(env.DB);
    const solo = await personWithOrganizations(["Solo Org"]);
    const several = await personWithOrganizations(["Alpha Org", "Beta Org"]);
    const [soloUser, severalUser] = await Promise.all(
      [solo.userId, several.userId].map(async (id) => {
        const [row] = await queryAll<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [id]);
        return row.email;
      }),
    );

    const soloToken = await signInWithLink(soloUser);
    expect(await claimedIdentity(soloToken)).toBe(solo.identityIds[0]);
    const severalToken = await signInWithLink(severalUser);
    expect(await claimedIdentity(severalToken)).toBeUndefined();
    expect((await currentSession(severalToken)).actingIdentityId).toBeNull();

    const signIns = await queryAll<{ actor_id: string; actor_identity_id: string | null }>(
      env.DB,
      "SELECT actor_id, actor_identity_id FROM audit_log WHERE action = 'user_magic_link_verified'",
    );
    expect(Object.fromEntries(signIns.map((row) => [row.actor_id, row.actor_identity_id]))).toEqual({
      [solo.userId]: solo.identityIds[0],
      [several.userId]: null,
    });
  });

  it("shows the acting identity's organization beside the actor in the audit log", async () => {
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    const adminToken = await createAdminSession(env.DB, admin.id, "acting-identity-audit-reader");
    const { userId, identityIds } = await personWithOrganizations(["Alpha Org", "Beta Org"]);
    const token = await createMemberSession(env.DB, userId, "audit-display", undefined, identityIds[1]);
    await updateFirstName(token, "Displayed");

    const response = await call(adminToken, "/api/v1/audit-log?action=user_profile_updated");
    expect(response.status).toBe(200);
    expect(auditLogListResponseSchema.parse(await response.json()).entries).toEqual([
      expect.objectContaining({
        actor_id: userId,
        actor_identity_id: identityIds[1],
        actor_organization_name: "Beta Org",
      }),
    ]);
  });
});
