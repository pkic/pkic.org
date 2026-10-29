import { queryAll } from "./helpers/context";
import { grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import {
  REPRESENTATIVE_ROLE_IDS,
  addRepresentative,
  assignRepresentativeRole,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function jsonRequest(path: string, token: string, method: string, body?: unknown): Promise<Response> {
  return callApi(env, path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function publicationFixture(visibility = "public") {
  const organizationId = await insertOrganization(env.DB, "Publication Lifecycle Organization");
  const memberId = visibility === "nonmember" ? null : await seedOrganizationAggregate(env.DB, organizationId);
  if (visibility === "inactive")
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run();
  const staffId = await insertUser(env.DB, "lifecycle-staff@example.test");
  await grantAdministrator(env.DB, staffId);
  const token = await createAdminSession(env.DB, staffId, "lifecycle-staff-token");
  const userId = await insertUser(env.DB, "lifecycle-target@example.test");
  const path = `/api/v1/organizations/${organizationId}/identities`;
  const command = {
    userReference: "existing_user",
    userId,
    jobTitle: "Engineer",
    showOnOrganizationProfile: visibility !== "hidden",
    activation: { mode: "immediate", reason: "Reviewed activation" },
  };
  return { organizationId, token, userId, path, command };
}
async function publicationRequests() {
  return (
    await env.DB.prepare(
      "SELECT resource_id FROM site_publication_requests WHERE resource_type='identity_profile' ORDER BY sequence",
    ).all()
  ).results;
}

beforeEach(async () => {
  await resetDb();
});

describe("organization identity API", () => {
  it("publishes active roster lifecycle changes and changed profiles, but not pending or unchanged edits", async () => {
    const { path, token, command } = await publicationFixture();
    const created = await jsonRequest(path, token, "POST", { ...command, activation: { mode: "invitation" } });
    expect(created.status, await created.clone().text()).toBe(201);
    let { identityId } = (await created.json()) as { identityId: string };
    const save = async (body: unknown) => {
      const response = await jsonRequest(`${path}/${identityId}`, token, "PATCH", body);
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as { identityId: string };
    };
    await save({ profile: { biography: "Pending biography" } });
    expect(await publicationRequests()).toHaveLength(0);
    await save({ transition: { state: "active", reason: "Reviewed pending activation" } });
    expect(await publicationRequests()).toEqual([{ resource_id: identityId }]);
    const repeated = await jsonRequest(`${path}/${identityId}`, token, "PATCH", {
      transition: { state: "active", reason: "Already active" },
    });
    expect(repeated.status).toBe(409);
    expect(await publicationRequests()).toHaveLength(1);
    await save({ profile: { biography: "Public biography", jobTitle: "Public Engineer" } });
    expect(await publicationRequests()).toHaveLength(2);
    await save({ profile: { biography: "Public biography", jobTitle: "Public Engineer" } });
    await save({ profile: { emailId: null } });
    expect(await publicationRequests()).toHaveLength(2);
    await save({ profile: { showOnOrganizationProfile: false } });
    expect(await publicationRequests()).toHaveLength(3);
    await save({ profile: { showOnOrganizationProfile: false } });
    expect(await publicationRequests()).toHaveLength(3);
    await save({ profile: { showOnOrganizationProfile: true } });
    expect(await publicationRequests()).toHaveLength(4);
    await save({ transition: { state: "blocked", reason: "Reviewed block" } });
    expect(await publicationRequests()).toHaveLength(5);
    const predecessor = identityId;
    identityId = (await save({ transition: { state: "active", reason: "Reviewed successor" } })).identityId;
    expect(identityId).not.toBe(predecessor);
    expect(await publicationRequests()).toHaveLength(6);
    await save({ transition: { state: "ended", reason: "Representation ended" } });
    expect(await publicationRequests()).toHaveLength(7);
    await save({ transition: { state: "active", reason: "Undo mistaken end" } });
    expect(await publicationRequests()).toHaveLength(8);
  });

  it.each(["hidden", "inactive", "nonmember"])("keeps %s roster changes quiet", async (visibility) => {
    const { path, token, command } = await publicationFixture(visibility);
    // Isolate the organization roster from public groups populated by automatic enrollment.
    await env.DB.prepare("UPDATE groups SET visibility='authenticated',public_roster=0,public_leadership=0").run();
    const created = await jsonRequest(path, token, "POST", command);
    expect(created.status, await created.clone().text()).toBe(201);
    const { identityId } = (await created.json()) as { identityId: string };
    if (visibility === "nonmember") {
      expect(await queryAll(env.DB, "SELECT id FROM members")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT member_id FROM member_category_assignments")).toEqual([]);
    }
    for (const body of [
      { profile: { biography: "Private biography" } },
      { transition: { state: "ended", reason: "Private representation ended" } },
      { transition: { state: "active", reason: "Undo private end" } },
    ]) {
      const response = await jsonRequest(`${path}/${identityId}`, token, "PATCH", body);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await publicationRequests()).toHaveLength(0);
    }
  });

  it.each(["creation", "profile"])(
    "rolls back %s when publication cannot commit, then permits retry",
    async (operation) => {
      const { path, token, command, userId } = await publicationFixture();
      let identityId: string | undefined;
      if (operation === "profile") {
        const created = await jsonRequest(path, token, "POST", command);
        expect(created.status, await created.clone().text()).toBe(201);
        identityId = ((await created.json()) as { identityId: string }).identityId;
      }
      const state = async () =>
        (
          await env.DB.prepare("SELECT id,biography,updated_at FROM identities WHERE user_id=? ORDER BY id")
            .bind(userId)
            .all()
        ).results;
      const before = await state();
      const requests = await publicationRequests();
      const ledger = await queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY sequence");
      const attempt = () =>
        operation === "creation"
          ? jsonRequest(path, token, "POST", command)
          : jsonRequest(`${path}/${identityId}`, token, "PATCH", { profile: { biography: "Published after retry" } });
      await env.DB.prepare(`CREATE TRIGGER fail_organization_publication BEFORE INSERT ON site_publication_requests
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_ORGANIZATION_PUBLICATION_FAILURE'); END`).run();
      try {
        expect((await attempt()).status).toBe(500);
        expect(await state()).toEqual(before);
        expect(await publicationRequests()).toEqual(requests);
        expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY sequence")).toEqual(ledger);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_organization_publication").run();
      }
      const retried = await attempt();
      expect(retried.status, await retried.clone().text()).toBe(operation === "creation" ? 201 : 200);
      expect(await publicationRequests()).toHaveLength(requests.length + 1);
    },
  );

  it("lists imported organization identities with the directory's exact query", async () => {
    const organizationId = await insertOrganization(env.DB, "Imported organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const userId = await insertUser(env.DB, "imported-roster@example.test");
    const identityId = await addRepresentative(env.DB, memberId, userId);
    await env.DB.prepare(
      "UPDATE identities SET source = 'migration', invited_at = '2026-09-01 12:34:56', started_at = '2026-09-01 12:34:56', created_at = '2026-09-01 12:34:56', updated_at = '2026-09-01 12:34:56' WHERE id = ?",
    )
      .bind(identityId)
      .run();
    await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const token = await createMemberSession(env.DB, userId, "imported-roster-contact", undefined, identityId);
    const response = await jsonRequest(
      `/api/v1/organizations/${organizationId}/identities?limit=25&offset=0&sort=user_name`,
      token,
      "GET",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      identities: [{ id: identityId, invitedAt: "2026-09-01T12:34:56.000Z", startedAt: "2026-09-01T12:34:56.000Z" }],
    });
  });

  it("lets an active organization contact invite, list, update, and end an exact identity", async () => {
    const organizationId = await insertOrganization(env.DB, "Representation API Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const contactUserId = await insertUser(env.DB, "contact@representation-api.example");
    const contactIdentityId = await addRepresentative(env.DB, memberId, contactUserId);
    await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const token = await createMemberSession(
      env.DB,
      contactUserId,
      "organization-contact-identity-token",
      undefined,
      contactIdentityId,
    );
    const targetUserId = await insertUser(env.DB, "target@gmail.com");

    const associate = await jsonRequest(`/api/v1/organizations/${organizationId}/identities`, token, "POST", {
      userReference: "existing_user",
      jobTitle: "Representative",
      userId: targetUserId,
      activation: { mode: "invitation" },
      showOnOrganizationProfile: true,
    });
    expect(associate.status, await associate.clone().text()).toBe(201);
    const invitation = (await associate.json()) as { identityId: string; state: string };
    expect(invitation).toMatchObject({ success: true, identityId: expect.any(String), state: "pending" });

    const listed = await jsonRequest(
      `/api/v1/organizations/${organizationId}/identities?q=target%40gmail.com`,
      token,
      "GET",
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      identities: Array<{ id: string; userId: string; source: string; state: string }>;
      page: unknown;
    };
    expect(listBody.identities).toHaveLength(1);
    expect(listBody.identities[0]).toMatchObject({
      id: invitation.identityId,
      userId: targetUserId,
      source: "organization_contact",
      state: "pending",
    });
    expect(listBody.page).toBeTruthy();

    const updated = await jsonRequest(
      `/api/v1/organizations/${organizationId}/identities/${invitation.identityId}`,
      token,
      "PATCH",
      { profile: { showOnOrganizationProfile: false } },
    );
    expect(updated.status).toBe(200);

    const ended = await jsonRequest(
      `/api/v1/organizations/${organizationId}/identities/${invitation.identityId}`,
      token,
      "PATCH",
      { transition: { state: "ended", reason: "Invitation withdrawn by organization contact" } },
    );
    expect(ended.status, await ended.clone().text()).toBe(200);
    expect(await ended.json()).toMatchObject({ identityId: invitation.identityId, state: "ended" });

    expect((await jsonRequest(`/api/v1/organizations/${organizationId}/representatives`, token, "GET")).status).toBe(
      404,
    );
  });

  it("does not grant identity-management access to an ordinary organization identity", async () => {
    const organizationId = await insertOrganization(env.DB, "Representation API Auth Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const ordinaryUserId = await insertUser(env.DB, "ordinary@representation-api.example");
    const identityId = await addRepresentative(env.DB, memberId, ordinaryUserId);
    const token = await createMemberSession(env.DB, ordinaryUserId, "ordinary-identity-token", undefined, identityId);

    const response = await jsonRequest(`/api/v1/organizations/${organizationId}/identities`, token, "GET");
    expect(response.status).toBe(403);
  });

  it("requires identities:activate, a reason, and a user-backed staff session for immediate activation", async () => {
    const organizationId = await insertOrganization(env.DB, "Immediate Identity Org");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    const staffUserId = await insertUser(env.DB, "staff@immediate-identity.example");
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'membership:write', NULL, NULL, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, staffUserId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffUserId, "immediate-identity-staff-token");
    const command = {
      userReference: "email",
      name: "New Identity",
      email: "new@immediate-identity.example",
      jobTitle: "Security Engineer",
      links: ["https://example.test/profile"],
      showOnOrganizationProfile: true,
      activation: { mode: "immediate", reason: "Approved membership correction" },
    };

    expect(
      (await jsonRequest(`/api/v1/organizations/${organizationId}/identities`, staffToken, "POST", command)).status,
    ).toBe(403);
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'identities:activate', NULL, NULL, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, staffUserId)
      .run();

    const created = await jsonRequest(
      `/api/v1/organizations/${organizationId}/identities`,
      staffToken,
      "POST",
      command,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const receipt = (await created.json()) as { identityId: string; state: string };
    expect(receipt).toMatchObject({ state: "active" });
    expect(await publicationRequests()).toEqual([{ resource_id: receipt.identityId }]);
    expect(
      await env.DB.prepare("SELECT job_title, links_json, started_at FROM identities WHERE id = ?")
        .bind(receipt.identityId)
        .first(),
    ).toMatchObject({
      job_title: "Security Engineer",
      links_json: '["https://example.test/profile"]',
      started_at: expect.any(String),
    });
    expect(
      await env.DB.prepare(
        "SELECT action, details_json FROM audit_log WHERE action = 'organization_identity_activated' AND entity_id = ?",
      )
        .bind(receipt.identityId)
        .first(),
    ).toMatchObject({ action: "organization_identity_activated", details_json: expect.stringContaining("reason") });

    expect(
      (
        await jsonRequest(
          `/api/v1/organizations/${organizationId}/identities`,
          env.ADMIN_API_KEY ?? "test-admin-key",
          "POST",
          {
            ...command,
            email: "machine@immediate-identity.example",
          },
        )
      ).status,
    ).toBe(403);
  });

  it("surfaces each identity headshot the same way the self-profile does, and null when none is set", async () => {
    const organizationId = await insertOrganization(env.DB, "Headshot Projection Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const photographedUserId = await insertUser(env.DB, "photographed@headshot-projection.example");
    const bareUserId = await insertUser(env.DB, "bare@headshot-projection.example");
    await addRepresentative(env.DB, memberId, photographedUserId);
    await addRepresentative(env.DB, memberId, bareUserId);
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?")
      .bind(`headshots/${photographedUserId}/portrait.webp`, photographedUserId)
      .run();

    const staffUserId = await insertUser(env.DB, "staff@headshot-projection.example");
    await grantAdministrator(env.DB, staffUserId);
    const staffToken = await createAdminSession(env.DB, staffUserId, "headshot-projection-staff-token");
    const listed = await jsonRequest(`/api/v1/organizations/${organizationId}/identities`, staffToken, "GET");
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      identities: Array<{ userId: string; headshotUrl: string | null }>;
    };

    const photographed = listBody.identities.find((identity) => identity.userId === photographedUserId);
    const bare = listBody.identities.find((identity) => identity.userId === bareUserId);
    expect(photographed?.headshotUrl).toBe(`/api/v1/users/${photographedUserId}/headshots/portrait.webp`);
    expect(bare?.headshotUrl).toBeNull();
  });
});
