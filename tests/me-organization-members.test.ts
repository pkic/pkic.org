/**
 * me-organization-members.test.ts
 *
 * POST /api/v1/organizations/:organizationId/identities — organization-contact
 * identity invitations (see functions/_lib/services/member-organization.ts).
 * Mirrors me-endpoints.test.ts's setup/imports pattern for
 * member-session-authenticated requests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { addCoworker } from "../functions/_lib/services/member-organization";
import type { AuthMember } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  insertUser,
  insertOrganization,
  seedOrganizationAggregate,
  addRepresentative,
  assignRepresentativeRole,
  insertIndividualMember,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";

function requestWithAuth(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    requestWithAuth(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

interface SeedOrgOptions {
  contactSlot?: "primary" | "secondary" | "none";
}

/** Seeds an organization with one active representative and, by default, sets that
 * representative as the primary contact. Returns both ids plus the rep's userId. */
async function seedOrgWithContact(
  email: string,
  category: string,
  { contactSlot = "primary" }: SeedOrgOptions = {},
): Promise<{ organizationId: string; userId: string; memberId: string; identityId: string }> {
  const organizationId = await insertOrganization(env.DB, `Org for ${email}`);
  const userId = await insertUser(env.DB, email);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, category);
  const identityId = await addRepresentative(env.DB, memberId, userId);

  if (contactSlot === "primary") {
    await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
  } else if (contactSlot === "secondary") {
    // Give the org a distinct primary contact first so this user is
    // unambiguously the *secondary* contact.
    const otherPrimaryId = await insertUser(env.DB, `primary-${email}`);
    await addRepresentative(env.DB, memberId, otherPrimaryId);
    await assignRepresentativeRole(env.DB, memberId, otherPrimaryId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await assignRepresentativeRole(env.DB, memberId, userId, REPRESENTATIVE_ROLE_IDS.secondaryContact);
  }

  return { organizationId, userId, memberId, identityId };
}

describe("POST organization identities — self-service coworker invitations", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets the primary contact invite a coworker into the same organization identity", async () => {
    const { organizationId, userId, identityId } = await seedOrgWithContact("primary@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "coworker-happy-token", undefined, identityId);

    const response = await call(token, `/api/v1/organizations/${organizationId}/identities`, {
      method: "POST",
      body: JSON.stringify({
        userReference: "email",
        name: "New Coworker",
        email: "coworker@example.test",
        activation: { mode: "invitation" },
        showOnOrganizationProfile: true,
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { identityId: string; state: string };
    expect(body.state).toBe("pending");
    const [createdUser] = await queryAll<{ id: string; email: string }>(
      env.DB,
      "SELECT id, email FROM users WHERE normalized_email = ?",
      "coworker@example.test",
    );
    expect(createdUser.email).toBe("coworker@example.test");

    // The coworker gets a pending identity against the same organization.
    // It does not become an active Member capacity before accepting.
    const identityRows = await queryAll<{
      id: string;
      organization_id: string;
      started_at: string | null;
      ended_at: string | null;
    }>(env.DB, "SELECT id, organization_id, started_at, ended_at FROM identities WHERE user_id = ?", createdUser.id);
    expect(identityRows).toHaveLength(1);
    expect(body.identityId).toBe(identityRows[0].id);
    expect(identityRows[0].organization_id).toBe(organizationId);
    expect(identityRows[0].started_at).toBeNull();
    expect(identityRows[0].ended_at).toBeNull();

    const memberRows = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM members WHERE user_id = ?",
      createdUser.id,
    );
    expect(Number(memberRows[0].total)).toBe(0);
  });

  it("lets the secondary contact add a coworker too", async () => {
    const { organizationId, userId, identityId } = await seedOrgWithContact("secondary@example.test", "A", {
      contactSlot: "secondary",
    });
    const token = await createMemberSession(env.DB, userId, "coworker-secondary-token", undefined, identityId);

    const response = await call(token, `/api/v1/organizations/${organizationId}/identities`, {
      method: "POST",
      body: JSON.stringify({
        userReference: "email",
        name: "Another Coworker",
        email: "another-coworker@example.test",
        activation: { mode: "invitation" },
        showOnOrganizationProfile: true,
      }),
    });

    expect(response.status).toBe(201);
  });

  it("rejects a non-contact org member with 403", async () => {
    const { organizationId, memberId } = await seedOrgWithContact("primary2@example.test", "F");
    // A second representative of the same org who is neither primary nor secondary contact.
    const nonContactUserId = await insertUser(env.DB, "non-contact@example.test");
    await addRepresentative(env.DB, memberId, nonContactUserId);
    const nonContactIdentityId = await env.DB.prepare(
      "SELECT id FROM identities WHERE user_id = ? AND organization_id = ?",
    )
      .bind(nonContactUserId, organizationId)
      .first<{ id: string }>();
    const token = await createMemberSession(
      env.DB,
      nonContactUserId,
      "non-contact-token",
      undefined,
      nonContactIdentityId!.id,
    );

    const response = await call(token, `/api/v1/organizations/${organizationId}/identities`, {
      method: "POST",
      body: JSON.stringify({
        userReference: "email",
        name: "Should Fail",
        email: "should-fail@example.test",
        activation: { mode: "invitation" },
        showOnOrganizationProfile: true,
      }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORGANIZATION_CONTACT_REQUIRED");
  });

  it("rejects an org-less individual member with 403", async () => {
    const { userId, identityId } = await insertIndividualMember(env.DB, "H6", "individual@example.test");
    const token = await createMemberSession(env.DB, userId, "individual-token", undefined, identityId);

    const response = await call(token, `/api/v1/organizations/${crypto.randomUUID()}/identities`, {
      method: "POST",
      body: JSON.stringify({
        userReference: "email",
        name: "Should Fail",
        email: "should-fail-2@example.test",
        activation: { mode: "invitation" },
        showOnOrganizationProfile: true,
      }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("rejects an email that is already an active representative of this same organization with 409", async () => {
    const { organizationId, memberId, userId, identityId } = await seedOrgWithContact("primary3@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "already-member-token", undefined, identityId);
    // Someone already an active representative of this exact organization.
    const existingRepUserId = await insertUser(env.DB, "existing-rep@example.test");
    await addRepresentative(env.DB, memberId, existingRepUserId);

    const response = await call(token, `/api/v1/organizations/${organizationId}/identities`, {
      method: "POST",
      body: JSON.stringify({
        userReference: "email",
        name: "Existing Rep",
        email: "existing-rep@example.test",
        activation: { mode: "invitation" },
        showOnOrganizationProfile: true,
      }),
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IDENTITY_ALREADY_ACTIVE");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/organizations/${crypto.randomUUID()}/identities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userReference: "email",
          name: "Nobody",
          email: "nobody@example.test",
          activation: { mode: "invitation" },
          showOnOrganizationProfile: true,
        }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(401);
  });

  it("rolls back both user and representative creation when contact authority changes before commit", async () => {
    const email = `racing-contact-${crypto.randomUUID()}@example.test`;
    const { memberId, userId, organizationId, identityId } = await seedOrgWithContact(
      `racing-primary-${crypto.randomUUID()}@example.test`,
      "F",
    );
    const member: AuthMember = {
      userId,
      identityId,
      email: `racing-primary-${crypto.randomUUID()}@example.test`,
      memberId,
      organizationId,
      membershipCategory: "F",
      isEcMember: false,
      activeIdentities: [{ identityId, memberId, organizationId, organizationName: null, membershipCategory: "F" }],
    };
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `UPDATE user_roles SET revoked_at = datetime('now')
            WHERE user_id = ? AND role_id = ? AND context_type = 'organization' AND context_id = ?`,
      )
        .bind(userId, REPRESENTATIVE_ROLE_IDS.primaryContact, memberId)
        .run(),
    );

    await expect(addCoworker(racingDb, member, { name: "Racing Coworker", email })).rejects.toMatchObject({
      status: 409,
      code: "IDENTITY_AUTHORIZATION_CHANGED",
    });
    expect(
      await queryAll<{ total: number }>(env.DB, "SELECT COUNT(*) AS total FROM users WHERE normalized_email = ?", [
        email,
      ]),
    ).toEqual([{ total: 0 }]);
  });
});
