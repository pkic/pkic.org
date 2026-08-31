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

beforeEach(async () => {
  await resetDb();
});

describe("organization identity API", () => {
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
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffUserId).run();
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
