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

describe("organization representation API", () => {
  it("lets an active organization contact associate, list, block, and explicitly restore a representative", async () => {
    const organizationId = await insertOrganization(env.DB, "Representation API Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const contactUserId = await insertUser(env.DB, "contact@representation-api.example");
    await addRepresentative(env.DB, memberId, contactUserId);
    await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const token = await createMemberSession(env.DB, contactUserId, "organization-contact-representation-token");
    const targetUserId = await insertUser(env.DB, "target@gmail.com");

    const associate = await jsonRequest(`/api/v1/organizations/${organizationId}/representatives`, token, "POST", {
      kind: "existing_user",
      userId: targetUserId,
      showOnOrganizationProfile: true,
    });
    expect(associate.status).toBe(201);
    expect(await associate.json()).toMatchObject({ success: true, representativeId: expect.any(String) });

    const listed = await jsonRequest(
      `/api/v1/organizations/${organizationId}/representatives?q=target%40gmail.com&active=true`,
      token,
      "GET",
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      representatives: Array<{ userId: string; source: string }>;
      page: unknown;
    };
    expect(listBody.representatives).toHaveLength(1);
    expect(listBody.representatives[0]).toMatchObject({ userId: targetUserId, source: "organization_contact" });
    expect(listBody.page).toBeTruthy();

    const updated = await jsonRequest(
      `/api/v1/organizations/${organizationId}/representatives/${targetUserId}`,
      token,
      "PATCH",
      { showOnOrganizationProfile: false },
    );
    expect(updated.status).toBe(200);

    const blocked = await jsonRequest(
      `/api/v1/organizations/${organizationId}/representatives/${targetUserId}`,
      token,
      "DELETE",
      { reason: "No longer represents the organization" },
    );
    expect(blocked.status).toBe(200);

    const restore = await jsonRequest(
      `/api/v1/organizations/${organizationId}/representatives/${targetUserId}/restore`,
      token,
      "POST",
      { reason: "Representation restored" },
    );
    expect(restore.status).toBe(200);
  });

  it("does not grant representative-management access to an ordinary representative", async () => {
    const organizationId = await insertOrganization(env.DB, "Representation API Auth Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const ordinaryUserId = await insertUser(env.DB, "ordinary@representation-api.example");
    await addRepresentative(env.DB, memberId, ordinaryUserId);
    const token = await createMemberSession(env.DB, ordinaryUserId, "ordinary-representation-token");

    const response = await jsonRequest(`/api/v1/organizations/${organizationId}/representatives`, token, "GET");
    expect(response.status).toBe(403);
  });

  it("reserves direct-email provisioning for a live, user-backed membership writer", async () => {
    const organizationId = await insertOrganization(env.DB, "Direct Email Representation Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const contactUserId = await insertUser(env.DB, "contact@direct-email.example");
    await addRepresentative(env.DB, memberId, contactUserId);
    await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const contactToken = await createMemberSession(env.DB, contactUserId, "direct-email-contact-token");

    const directEmail = {
      kind: "email",
      name: "New Representative",
      email: "new@direct-email.example",
      jobTitle: "Security Engineer",
      links: ["https://example.test/profile"],
    };
    expect(
      (await jsonRequest(`/api/v1/organizations/${organizationId}/representatives`, contactToken, "POST", directEmail))
        .status,
    ).toBe(401);
    expect(
      (
        await jsonRequest(
          `/api/v1/organizations/${organizationId}/representatives`,
          env.ADMIN_API_KEY ?? "test-admin-key",
          "POST",
          directEmail,
        )
      ).status,
    ).toBe(403);

    const staffUserId = await insertUser(env.DB, "staff@direct-email.example");
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'membership:write', NULL, NULL, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffUserId, staffUserId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffUserId, "direct-email-staff-token");
    const created = await jsonRequest(
      `/api/v1/organizations/${organizationId}/representatives`,
      staffToken,
      "POST",
      directEmail,
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ success: true, representativeId: expect.any(String) });
    expect(
      await env.DB.prepare(
        "SELECT job_title, links_json FROM users WHERE normalized_email = 'new@direct-email.example'",
      ).all(),
    ).toMatchObject({
      results: [{ job_title: "Security Engineer", links_json: '["https://example.test/profile"]' }],
    });
    expect(
      await env.DB.prepare("SELECT id FROM email_outbox WHERE recipient_email = 'new@direct-email.example'").all(),
    ).toMatchObject({ results: [] });
  });
});
