/**
 * organization-multi-representation.test.ts
 *
 * Organization self-service is authorized by the exact acting identity in
 * the caller's session. A user with more than one identity must explicitly
 * switch before acting for another organization; downstream services remain
 * bound to that selected identity's Member aggregate.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import {
  insertUser,
  insertOrganization,
  seedOrganizationAggregate,
  addRepresentative,
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

/**
 * Seeds two organization identities for the same user and exact sessions for
 * each identity.
 */
async function seedDualRepresentation(userEmail: string): Promise<{
  userId: string;
  firstToken: string;
  secondToken: string;
  first: { organizationId: string; memberId: string; identityId: string };
  second: { organizationId: string; memberId: string; identityId: string };
}> {
  const userId = await insertUser(env.DB, userEmail);

  const firstOrganizationId = await insertOrganization(env.DB, `First org for ${userEmail}`);
  const firstMemberId = await seedOrganizationAggregate(env.DB, firstOrganizationId, "F");
  const firstIdentityId = await addRepresentative(env.DB, firstMemberId, userId);

  const secondOrganizationId = await insertOrganization(env.DB, `Second org for ${userEmail}`);
  const secondMemberId = await seedOrganizationAggregate(env.DB, secondOrganizationId, "A");
  const secondIdentityId = await addRepresentative(env.DB, secondMemberId, userId);

  const firstToken = await createMemberSession(
    env.DB,
    userId,
    `first-identity-${userEmail}`,
    undefined,
    firstIdentityId,
  );
  const secondToken = await createMemberSession(
    env.DB,
    userId,
    `second-identity-${userEmail}`,
    undefined,
    secondIdentityId,
  );
  return {
    userId,
    firstToken,
    secondToken,
    first: { organizationId: firstOrganizationId, memberId: firstMemberId, identityId: firstIdentityId },
    second: { organizationId: secondOrganizationId, memberId: secondMemberId, identityId: secondIdentityId },
  };
}

describe("Organization self-service authorized by representation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("requires the matching acting identity for each organization profile", async () => {
    const { firstToken, secondToken, first, second } = await seedDualRepresentation("dual-profile@example.test");

    const firstResponse = await call(firstToken, `/api/v1/organizations/${first.organizationId}/profile`);
    expect(firstResponse.status).toBe(200);
    expect((await firstResponse.json()) as { organization: { id: string } }).toMatchObject({
      organization: { id: first.organizationId },
    });

    expect((await call(firstToken, `/api/v1/organizations/${second.organizationId}/profile`)).status).toBe(404);
    const secondResponse = await call(secondToken, `/api/v1/organizations/${second.organizationId}/profile`);
    expect(secondResponse.status).toBe(200);
    expect((await secondResponse.json()) as { organization: { id: string } }).toMatchObject({
      organization: { id: second.organizationId },
    });
  });

  it("still 404s an organization the caller does not represent, even though it exists", async () => {
    const { firstToken } = await seedDualRepresentation("no-third-org@example.test");
    const unrelatedOrganizationId = await insertOrganization(env.DB, "Unrelated org");
    await seedOrganizationAggregate(env.DB, unrelatedOrganizationId, "A");

    const response = await call(firstToken, `/api/v1/organizations/${unrelatedOrganizationId}/profile`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("binds isPrimaryContact/isOrgContact to the selected identity's organization", async () => {
    const { userId, firstToken, secondToken, first, second } =
      await seedDualRepresentation("contact-binding@example.test");
    await assignRepresentativeRole(env.DB, second.memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);

    const firstProfile = (await (
      await call(firstToken, `/api/v1/organizations/${first.organizationId}/profile`)
    ).json()) as {
      organization: { isPrimaryContact: boolean; isOrgContact: boolean };
    };
    expect(firstProfile.organization).toMatchObject({ isPrimaryContact: false, isOrgContact: false });

    const secondProfile = (await (
      await call(secondToken, `/api/v1/organizations/${second.organizationId}/profile`)
    ).json()) as { organization: { isPrimaryContact: boolean; isOrgContact: boolean } };
    expect(secondProfile.organization).toMatchObject({ isPrimaryContact: true, isOrgContact: true });
  });

  it("denies a plain identity's content-review submission", async () => {
    const { secondToken, second } = await seedDualRepresentation("plain-rep-second@example.test");

    const response = await call(secondToken, `/api/v1/organizations/${second.organizationId}/content/reviews`, {
      method: "POST",
      body: JSON.stringify({ slogan: "Should be denied" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_ORG_CONTACT");
  });

  it("lets a selected primary-contact identity submit and withdraw a review attributed to its organization", async () => {
    const { userId, secondToken, first, second } = await seedDualRepresentation("second-org-contact@example.test");
    await assignRepresentativeRole(env.DB, second.memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);

    const submitResponse = await call(secondToken, `/api/v1/organizations/${second.organizationId}/content/reviews`, {
      method: "POST",
      body: JSON.stringify({ slogan: "Bound to the requested org" }),
    });
    expect(submitResponse.status).toBe(200);
    const { review } = (await submitResponse.json()) as { review: { id: string } };

    // Attributed to the REQUESTED organization (second), never the acting
    // one (first) — this is the memberId/organizationId audit-trail
    // guarantee the authorization rework must preserve.
    const [reviewRow] = await queryAll<{ organization_id: string; submitted_by_user_id: string }>(
      env.DB,
      "SELECT organization_id, submitted_by_user_id FROM organization_content_reviews WHERE id = ?",
      review.id,
    );
    expect(reviewRow).toEqual({ organization_id: second.organizationId, submitted_by_user_id: userId });
    expect(reviewRow.organization_id).not.toBe(first.organizationId);

    const withdrawResponse = await call(
      secondToken,
      `/api/v1/organizations/${second.organizationId}/content/reviews/${review.id}`,
      { method: "DELETE" },
    );
    expect(withdrawResponse.status).toBe(200);
    const [withdrawn] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM organization_content_reviews WHERE id = ?",
      review.id,
    );
    expect(withdrawn.status).toBe("withdrawn");
  });

  it("lets a selected primary-contact identity nominate its secondary contact", async () => {
    const {
      userId: primaryUserId,
      secondToken,
      second,
    } = await seedDualRepresentation("second-org-nominate@example.test");
    await assignRepresentativeRole(env.DB, second.memberId, primaryUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const nomineeUserId = await insertUser(env.DB, "nominee-second-org@example.test");
    await addRepresentative(env.DB, second.memberId, nomineeUserId);

    const response = await call(
      secondToken,
      `/api/v1/organizations/${second.organizationId}/contacts/secondary/nomination`,
      {
        method: "PUT",
        body: JSON.stringify({ userId: nomineeUserId }),
      },
    );
    expect(response.status).toBe(200);

    const [nomination] = await queryAll<{ nominated_user_id: string }>(
      env.DB,
      "SELECT nominated_user_id FROM organization_secondary_contact_nominations WHERE member_id = ?",
      second.memberId,
    );
    expect(nomination.nominated_user_id).toBe(nomineeUserId);
  });

  it("still requires an active membership session with 401 for an anonymous caller", async () => {
    const { second } = await seedDualRepresentation("anon-check@example.test");
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/organizations/${second.organizationId}/profile`),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(401);
  });
});
