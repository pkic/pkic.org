/**
 * user-merge.test.ts
 *
 * Secondary email addresses (`user_emails`) and the account-merge tool
 * built to consolidate the duplicate `users` rows the YAML->D1 migration
 * created for the same person under different Google-Groups-roster
 * emails. Covers secondary email CRUD, the merge happy path (reassigning
 * working_group_members/members/user_roles/permission_grants/
 * passkey_credentials), the conflict cases, and the "no login effect"
 * decision (secondary emails must not resolve via magic-link auth).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { requestAdminMagicLink } from "../functions/_lib/auth/admin";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { insertOrganization, seedOrganizationAggregate, addRepresentative } from "./helpers/membership";
import { isActiveRepresentative } from "../functions/_lib/services/membership/representatives";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

async function insertWorkingGroup(name: string, slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, mailing_list_email, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, slug)
    .run();
  return id;
}

async function joinWorkingGroup(wgId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at) VALUES (?, ?, ?, datetime('now'), NULL)`,
  )
    .bind(crypto.randomUUID(), wgId, userId)
    .run();
}

async function insertMember(userId: string, membershipCategory: string): Promise<string> {
  const { memberId, statements } = buildCreateIndividualMemberStatements(
    env.DB,
    userId,
    membershipCategory,
    new Date().toISOString(),
  );
  await env.DB.batch(statements);
  return memberId;
}

async function insertPasskey(userId: string, credentialId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO passkey_credentials (id, user_id, credential_id, public_key, sign_count, created_at)
     VALUES (?, ?, ?, 'fake-public-key', 0, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, credentialId)
    .run();
}

describe("secondary emails + user merge", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-merge-token");
  });

  it("adds, lists, and removes a secondary email", async () => {
    const userId = await insertUser("primary@example.test");

    const addResponse = await call(adminToken, `/api/v1/admin/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "secondary@example.test" }),
    });
    expect(addResponse.status).toBe(201);
    const added = (await addResponse.json()) as { email: { id: string; email: string } };

    const listResponse = await call(adminToken, `/api/v1/admin/users/${userId}/emails`);
    const list = (await listResponse.json()) as { emails: Array<{ id: string; email: string }> };
    expect(list.emails.some((e) => e.id === added.email.id && e.email === "secondary@example.test")).toBe(true);

    const removeResponse = await call(adminToken, `/api/v1/admin/users/${userId}/emails/${added.email.id}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(200);

    const afterRemove = (await (await call(adminToken, `/api/v1/admin/users/${userId}/emails`)).json()) as {
      emails: Array<{ id: string }>;
    };
    expect(afterRemove.emails).toHaveLength(0);
  });

  it("rejects adding an email that already belongs to another user's primary or secondary address", async () => {
    const userA = await insertUser("user-a@example.test");
    const userB = await insertUser("user-b@example.test");

    const clashPrimary = await call(adminToken, `/api/v1/admin/users/${userA}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "user-b@example.test" }),
    });
    expect(clashPrimary.status).toBe(409);

    await call(adminToken, `/api/v1/admin/users/${userB}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "shared-alias@example.test" }),
    });
    const clashSecondary = await call(adminToken, `/api/v1/admin/users/${userA}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "shared-alias@example.test" }),
    });
    expect(clashSecondary.status).toBe(409);
  });

  it("adding a secondary email does not allow magic-link login via that alias", async () => {
    const userId = await insertUser("canonical@example.test");
    // Give this user staff access so it's eligible for a magic link at all.
    const staffRole = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM roles WHERE name = 'membership_processor'",
    );
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, staffRole[0].id, adminId)
      .run();

    await call(adminToken, `/api/v1/admin/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "alias@example.test" }),
    });

    const viaCanonical = await requestAdminMagicLink(env.DB, { email: "canonical@example.test", ttlMinutes: 15 });
    expect(viaCanonical.token).not.toBeNull();

    const viaAlias = await requestAdminMagicLink(env.DB, { email: "alias@example.test", ttlMinutes: 15 });
    expect(viaAlias.token).toBeNull();
    expect(viaAlias.admin).toBeNull();
  });

  it("merges a duplicate account: reassigns WG membership, roles, grants, passkeys, and records its email as secondary", async () => {
    const survivorId = await insertUser("survivor@example.test");
    const sourceId = await insertUser("duplicate@example.test");

    const wgId = await insertWorkingGroup("Merge Test WG", "merge-test-wg");
    await joinWorkingGroup(wgId, sourceId);

    const roleRow = await queryAll<{ id: string }>(env.DB, "SELECT id FROM roles WHERE name = 'membership_processor'");
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), sourceId, roleRow[0].id, adminId)
      .run();

    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at) VALUES (?, ?, 'donations:read', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), sourceId, adminId)
      .run();

    await insertPasskey(sourceId, "test-credential-id-1");
    await insertMember(sourceId, "F");

    const response = await call(adminToken, `/api/v1/admin/users/${survivorId}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourceUserId: sourceId }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { survivorId: string; mergedFromUserId: string; mergedFromEmail: string };
    expect(result.survivorId).toBe(survivorId);
    expect(result.mergedFromEmail).toBe("duplicate@example.test");

    const wgMembership = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM working_group_members WHERE working_group_id = ? AND left_at IS NULL",
      wgId,
    );
    expect(wgMembership).toHaveLength(1);
    expect(wgMembership[0].user_id).toBe(survivorId);

    const roles = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM user_roles WHERE role_id = ?",
      roleRow[0].id,
    );
    expect(roles.map((r) => r.user_id)).toContain(survivorId);

    const grants = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM permission_grants WHERE permission = 'donations:read'",
    );
    expect(grants.map((g) => g.user_id)).toContain(survivorId);

    const passkeys = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM passkey_credentials WHERE credential_id = 'test-credential-id-1'",
    );
    expect(passkeys[0].user_id).toBe(survivorId);

    const members = await queryAll<{ user_id: string }>(env.DB, "SELECT user_id FROM members");
    expect(members.map((m) => m.user_id)).toContain(survivorId);
    expect(members.map((m) => m.user_id)).not.toContain(sourceId);

    const secondaryEmails = (await (await call(adminToken, `/api/v1/admin/users/${survivorId}/emails`)).json()) as {
      emails: Array<{ email: string }>;
    };
    expect(secondaryEmails.emails.some((e) => e.email === "duplicate@example.test")).toBe(true);

    const sourceRow = (
      await queryAll<{ email: string; merged_into_user_id: string | null; active: number }>(
        env.DB,
        "SELECT email, merged_into_user_id, active FROM users WHERE id = ?",
        sourceId,
      )
    )[0];
    expect(sourceRow.merged_into_user_id).toBe(survivorId);
    expect(sourceRow.active).toBe(0);
    expect(sourceRow.email).not.toBe("duplicate@example.test");
  });

  it("merges organization_representatives rows, skipping an org the survivor already actively represents", async () => {
    const survivorId = await insertUser("rep-survivor@example.test");
    const sourceId = await insertUser("rep-source@example.test");

    const orgAId = await insertOrganization(env.DB, "Org A");
    const orgBId = await insertOrganization(env.DB, "Org B");
    const memberAId = await seedOrganizationAggregate(env.DB, orgAId, "A");
    const memberBId = await seedOrganizationAggregate(env.DB, orgBId, "B");

    // Source represents both orgs; survivor already actively represents org B.
    await addRepresentative(env.DB, memberAId, sourceId);
    await addRepresentative(env.DB, memberBId, sourceId);
    await addRepresentative(env.DB, memberBId, survivorId);

    const response = await call(adminToken, `/api/v1/admin/users/${survivorId}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourceUserId: sourceId }),
    });
    expect(response.status).toBe(200);

    // Org A: reassigned to the survivor (they had no conflicting active row there).
    expect(await isActiveRepresentative(env.DB, memberAId, survivorId)).toBe(true);
    expect(await isActiveRepresentative(env.DB, memberAId, sourceId)).toBe(false);

    // Org B: survivor's own pre-existing active row stands; the source's
    // row is left as harmless history rather than repointed into a
    // uq_organization_representatives_active_pair conflict.
    expect(await isActiveRepresentative(env.DB, memberBId, survivorId)).toBe(true);
    const sourceOrgBRow = (
      await queryAll<{ user_id: string; left_at: string | null }>(
        env.DB,
        "SELECT user_id, left_at FROM organization_representatives WHERE member_id = ? AND user_id = ?",
        memberBId,
        sourceId,
      )
    )[0];
    expect(sourceOrgBRow).toBeDefined();
  });

  it("rejects a merge when both accounts hold a membership", async () => {
    const survivorId = await insertUser("survivor-both@example.test");
    const sourceId = await insertUser("duplicate-both@example.test");
    await insertMember(survivorId, "F");
    await insertMember(sourceId, "G");

    const response = await call(adminToken, `/api/v1/admin/users/${survivorId}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourceUserId: sourceId }),
    });
    expect(response.status).toBe(409);
  });

  it("rejects merging into a survivor that was itself already merged into another account", async () => {
    const rootId = await insertUser("root@example.test");
    const middleId = await insertUser("middle@example.test");
    const newDuplicateId = await insertUser("new-duplicate@example.test");

    const firstMerge = await call(adminToken, `/api/v1/admin/users/${rootId}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourceUserId: middleId }),
    });
    expect(firstMerge.status).toBe(200);

    const secondMerge = await call(adminToken, `/api/v1/admin/users/${middleId}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourceUserId: newDuplicateId }),
    });
    expect(secondMerge.status).toBe(409);
  });

  it("Users list search matches a secondary email", async () => {
    const userId = await insertUser("findme-primary@example.test");
    await call(adminToken, `/api/v1/admin/users/${userId}/emails`, {
      method: "POST",
      body: JSON.stringify({ email: "findme-alias@example.test" }),
    });

    const searchResponse = await call(adminToken, "/api/v1/admin/users?q=findme-alias");
    const results = (await searchResponse.json()) as { users: Array<{ id: string }> };
    expect(results.users.some((u) => u.id === userId)).toBe(true);
  });
});
