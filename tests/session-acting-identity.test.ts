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
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { verifyUserSessionToken } from "../functions/_lib/auth/user-session";
import { findEligibleMemberById } from "../functions/_lib/auth/member";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { identitiesListResponseSchema } from "../assets/shared/schemas/identity";
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
      WHERE action IN ('identity_profile_updated', 'profile_names_updated') AND actor_id = ?
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
        membershipCategory: expect.any(String),
        membershipLabel: expect.any(String),
      },
    ]);
    expect(session.actingIdentityId).toBe(identityIds[0]);

    await updateFirstName(token, "Solo");
    expect(await profileUpdateIdentities(userId)).toEqual([identityIds[0]]);
  });

  it("keeps account-owned profile changes separate from the acting identity choice", async () => {
    const { userId, identityIds } = await personWithOrganizations(["Alpha Org", "Beta Org"]);
    const token = await createMemberSession(env.DB, userId, "several", undefined, null);

    const session = await currentSession(token);
    expect(session.actingIdentities.map((identity) => identity.organizationName)).toEqual(["Alpha Org", "Beta Org"]);
    expect(session.actingIdentityId).toBeNull();

    // Account-owned name changes do not require a Member capacity. They must
    // not claim an organization identity before the person chooses one.
    const undecided = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ firstName: "Undecided" }),
    });
    expect(undecided.status).toBe(200);
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

  it("finds the person's own identity under the mail domain they entered", async () => {
    const { userId, identityIds } = await personWithOrganizations(["Alpha Org", "Beta Org"]);
    const now = new Date().toISOString();
    const emailId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(emailId, userId, "Person@Beta.example", "person@beta.example", now, now),
      env.DB.prepare("UPDATE identities SET email_id = ? WHERE id = ?").bind(emailId, identityIds[1]),
    ]);
    const token = await createMemberSession(env.DB, userId, "domain", undefined, null);
    const list = async (domain: string) => {
      const response = await call(token, `/api/v1/users/current/identities?active=true&emailDomain=${domain}`);
      expect(response.status, await response.clone().text()).toBe(200);
      return identitiesListResponseSchema.parse(await response.json()).identities.map((identity) => identity.id);
    };
    expect(await list("Beta.Example")).toEqual([identityIds[1]]);
    expect(await list("elsewhere.example")).toEqual([]);
    const invalid = await call(token, "/api/v1/users/current/identities?emailDomain=not%20a%20domain");
    expect(invalid.status).toBe(400);
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

  it("keeps each concurrent request's acting identity in its own scope", async () => {
    const first = await personWithOrganizations(["Gamma Org", "Delta Org"]);
    const second = await personWithOrganizations(["Epsilon Org", "Zeta Org"]);
    const firstToken = await createMemberSession(env.DB, first.userId, "concurrent-a", undefined, first.identityIds[0]);
    const secondToken = await createMemberSession(
      env.DB,
      second.userId,
      "concurrent-b",
      undefined,
      second.identityIds[1],
    );
    // Each person's own edits are sequential (a profile edit is guarded against a concurrent one); the two
    // people's requests interleave.
    const edits = async (token: string, prefix: string) => {
      for (let index = 0; index < 3; index += 1) await updateFirstName(token, `${prefix}${index}`);
    };
    await Promise.all([edits(firstToken, "First"), edits(secondToken, "Second")]);

    expect(await profileUpdateIdentities(first.userId)).toEqual(Array(3).fill(first.identityIds[0]));
    expect(await profileUpdateIdentities(second.userId)).toEqual(Array(3).fill(second.identityIds[1]));
  });

  it("shows the acting identity's organization beside the actor in the audit log", async () => {
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    const adminToken = await createAdminSession(env.DB, admin.id, "acting-identity-audit-reader");
    const { userId, identityIds } = await personWithOrganizations(["Alpha Org", "Beta Org"]);
    const token = await createMemberSession(env.DB, userId, "audit-display", undefined, identityIds[1]);
    await updateFirstName(token, "Displayed");

    const response = await call(adminToken, "/api/v1/audit-log?action=identity_profile_updated");
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

/** A member in their own right who also works for an organization that is not a member. */
async function individualMemberWithNonmemberEmployer() {
  const person = await insertIndividualMember(env.DB, "H6");
  const organizationId = await insertOrganization(env.DB, "Nonmember Employer");
  const affiliation = await buildCreateIdentityStatement(env.DB, {
    userId: person.userId,
    organizationId,
    source: "staff",
    startImmediately: true,
  });
  await affiliation.statement.run();
  return { ...person, affiliationId: affiliation.identityId };
}

async function ownUserRecord(token: string): Promise<number> {
  return (await call(token, "/api/v1/users/current")).status;
}

describe("member context follows the acting identity", () => {
  beforeEach(resetDb);

  it("tells each identity whether it brings a membership", async () => {
    const person = await individualMemberWithNonmemberEmployer();
    const token = await createMemberSession(env.DB, person.userId, "membership-notes", undefined, null);

    const byId = new Map((await currentSession(token)).actingIdentities.map((identity) => [identity.id, identity]));
    expect(byId.get(person.identityId)?.membershipCategory).toEqual(expect.any(String));
    expect(byId.get(person.affiliationId)?.membershipCategory).toBeNull();
  });

  it("gives a person who is a member only through an organization no membership of their own", async () => {
    const userId = await insertUser(env.DB);
    const personal = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId: null,
      source: "staff",
      startImmediately: true,
    });
    await personal.statement.run();
    const organizationId = await insertOrganization(env.DB, "Member Employer");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId);
    const represented = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Delegate" });

    const token = await createMemberSession(env.DB, userId, "org-only-member", undefined, personal.identityId);
    const session = await currentSession(token);
    const byId = new Map(session.actingIdentities.map((identity) => [identity.id, identity]));
    // The personal identity states no membership, and acting as it carries no member context or permission.
    expect(byId.get(personal.identityId)?.membershipCategory).toBeNull();
    expect(byId.get(represented)?.membershipCategory).toEqual(expect.any(String));
    expect(session.actingIdentityId).toBe(personal.identityId);
    expect(session.member).toBeUndefined();

    // Representing the member organization is what brings the membership.
    const asMember = await selectIdentity(token, represented);
    expect(userAuthSessionResponseSchema.parse(await asMember.json()).member).toMatchObject({ memberId });
  });

  it("gives no member context while acting as an identity that holds no membership", async () => {
    const person = await individualMemberWithNonmemberEmployer();
    const token = await createMemberSession(
      env.DB,
      person.userId,
      "nonmember-identity",
      undefined,
      person.affiliationId,
    );

    const session = await currentSession(token);
    expect(session.actingIdentityId).toBe(person.affiliationId);
    expect(session.member).toBeUndefined();
    expect(await ownUserRecord(token)).toBe(200);
  });

  it("restores member context on switching to the identity that holds the membership, and drops it again", async () => {
    const person = await individualMemberWithNonmemberEmployer();
    const token = await createMemberSession(env.DB, person.userId, "switching", undefined, person.affiliationId);

    const toMember = await selectIdentity(token, person.identityId);
    expect(toMember.status).toBe(200);
    expect(userAuthSessionResponseSchema.parse(await toMember.json()).member).toMatchObject({
      identityId: person.identityId,
      memberId: person.memberId,
    });
    const asMember = toMember.headers.get("x-user-token")!;
    expect(await ownUserRecord(asMember)).toBe(200);

    const back = await selectIdentity(asMember, person.affiliationId);
    expect(userAuthSessionResponseSchema.parse(await back.json()).member).toBeUndefined();
    expect(await ownUserRecord(back.headers.get("x-user-token")!)).toBe(200);
  });

  it("signs in a member with several identities, but gives no member context until they choose", async () => {
    await seedEventAndAdmin(env.DB);
    const person = await individualMemberWithNonmemberEmployer();
    const [{ email }] = await queryAll<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [
      person.userId,
    ]);

    const token = await signInWithLink(email);
    const session = await currentSession(token);
    expect(session.actingIdentityId).toBeNull();
    expect(session.member).toBeUndefined();
    expect(await ownUserRecord(token)).toBe(200);
  });

  it("resolves an individual membership through the personal identity that holds it, not through the person", async () => {
    const person = await insertIndividualMember(env.DB, "H6");
    expect(await findEligibleMemberById(env.DB, person.userId, person.identityId)).toMatchObject({
      identityId: person.identityId,
      memberId: person.memberId,
    });

    // A later personal identity of the same person does not inherit it.
    await endIdentity(person.identityId);
    const successor = await buildCreateIdentityStatement(env.DB, {
      userId: person.userId,
      organizationId: null,
      source: "staff",
      startImmediately: true,
    });
    await successor.statement.run();
    expect(await findEligibleMemberById(env.DB, person.userId, successor.identityId)).toBeNull();
    expect(await findEligibleMemberById(env.DB, person.userId)).toBeNull();
  });
});
