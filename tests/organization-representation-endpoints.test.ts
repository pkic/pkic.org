import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
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
});
