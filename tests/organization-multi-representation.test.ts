/**
 * organization-multi-representation.test.ts
 *
 * Organization self-service is authorized by representation, not by the
 * caller's currently selected acting capacity
 * (functions/api/v1/organizations/authorization.ts). A user representing
 * several organizations must reach each one's workspace — GET, POST, DELETE —
 * without ever calling PUT /api/v1/users/current/memberships/active. Every
 * downstream service must also be bound to the REQUESTED organization's
 * memberId, not the acting one, since that memberId drives audit
 * attribution and contact-role checks.
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
 * Seeds two organizations represented by the SAME user, in join order —
 * `first` becomes the session's acting capacity (`member.organizationId`,
 * see toAuthMember's earliest-joined-first ordering); `second` is only
 * reachable through `activeMemberships` before this change.
 */
async function seedDualRepresentation(userEmail: string): Promise<{
  userId: string;
  token: string;
  first: { organizationId: string; memberId: string };
  second: { organizationId: string; memberId: string };
}> {
  const userId = await insertUser(env.DB, userEmail);

  const firstOrganizationId = await insertOrganization(env.DB, `First org for ${userEmail}`);
  const firstMemberId = await seedOrganizationAggregate(env.DB, firstOrganizationId, "F");
  await addRepresentative(env.DB, firstMemberId, userId);

  const secondOrganizationId = await insertOrganization(env.DB, `Second org for ${userEmail}`);
  const secondMemberId = await seedOrganizationAggregate(env.DB, secondOrganizationId, "A");
  await addRepresentative(env.DB, secondMemberId, userId);

  const token = await createMemberSession(env.DB, userId, `dual-rep-${userEmail}`);
  return {
    userId,
    token,
    first: { organizationId: firstOrganizationId, memberId: firstMemberId },
    second: { organizationId: secondOrganizationId, memberId: secondMemberId },
  };
}

describe("Organization self-service authorized by representation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reads both organization profiles without switching acting capacity", async () => {
    const { token, first, second } = await seedDualRepresentation("dual-profile@example.test");

    const firstResponse = await call(token, `/api/v1/organizations/${first.organizationId}/profile`);
    expect(firstResponse.status).toBe(200);
    expect((await firstResponse.json()) as { organization: { id: string } }).toMatchObject({
      organization: { id: first.organizationId },
    });

    // `second` was never the acting capacity baked into the session — the
    // acting member.organizationId is `first` because it joined earliest.
    const secondResponse = await call(token, `/api/v1/organizations/${second.organizationId}/profile`);
    expect(secondResponse.status).toBe(200);
    expect((await secondResponse.json()) as { organization: { id: string } }).toMatchObject({
      organization: { id: second.organizationId },
    });
  });

  it("still 404s an organization the caller does not represent, even though it exists", async () => {
    const { token } = await seedDualRepresentation("no-third-org@example.test");
    const unrelatedOrganizationId = await insertOrganization(env.DB, "Unrelated org");
    await seedOrganizationAggregate(env.DB, unrelatedOrganizationId, "A");

    const response = await call(token, `/api/v1/organizations/${unrelatedOrganizationId}/profile`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("binds isPrimaryContact/isOrgContact to the requested organization, not the acting one", async () => {
    const { token, first, second } = await seedDualRepresentation("contact-binding@example.test");
    const [{ user_id: userId }] = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM organization_representatives WHERE member_id = ? LIMIT 1",
      second.memberId,
    );
    // Primary contact of `second` only — plain representative of `first`.
    await assignRepresentativeRole(env.DB, second.memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);

    const firstProfile = (await (
      await call(token, `/api/v1/organizations/${first.organizationId}/profile`)
    ).json()) as {
      organization: { isPrimaryContact: boolean; isOrgContact: boolean };
    };
    expect(firstProfile.organization).toMatchObject({ isPrimaryContact: false, isOrgContact: false });

    const secondProfile = (await (
      await call(token, `/api/v1/organizations/${second.organizationId}/profile`)
    ).json()) as { organization: { isPrimaryContact: boolean; isOrgContact: boolean } };
    expect(secondProfile.organization).toMatchObject({ isPrimaryContact: true, isOrgContact: true });
  });

  it("denies a plain (non-contact) representative's content-review submission on the non-acting organization", async () => {
    const { token, second } = await seedDualRepresentation("plain-rep-second@example.test");
    // No contact role assigned on `second` — the caller is a plain representative there.

    const response = await call(token, `/api/v1/organizations/${second.organizationId}/content/reviews`, {
      method: "POST",
      body: JSON.stringify({ slogan: "Should be denied" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_ORG_CONTACT");
  });

  it("lets the primary contact of the non-acting organization submit and withdraw a review attributed to it", async () => {
    const { token, first, second } = await seedDualRepresentation("second-org-contact@example.test");
    const [{ user_id: userId }] = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM organization_representatives WHERE member_id = ? LIMIT 1",
      second.memberId,
    );
    await assignRepresentativeRole(env.DB, second.memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);

    const submitResponse = await call(token, `/api/v1/organizations/${second.organizationId}/content/reviews`, {
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
      token,
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

  it("lets the primary contact of the non-acting organization nominate its secondary contact", async () => {
    const { token, second } = await seedDualRepresentation("second-org-nominate@example.test");
    const [{ user_id: primaryUserId }] = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM organization_representatives WHERE member_id = ? LIMIT 1",
      second.memberId,
    );
    await assignRepresentativeRole(env.DB, second.memberId, primaryUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    const nomineeUserId = await insertUser(env.DB, "nominee-second-org@example.test");
    await addRepresentative(env.DB, second.memberId, nomineeUserId);

    const response = await call(token, `/api/v1/organizations/${second.organizationId}/contacts/secondary/nomination`, {
      method: "PUT",
      body: JSON.stringify({ userId: nomineeUserId }),
    });
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
