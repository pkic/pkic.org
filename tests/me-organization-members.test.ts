/**
 * me-organization-members.test.ts
 *
 * POST /api/v1/me/organization/members — member-portal self-service
 * coworker enrollment (see functions/_lib/services/member-organization.ts).
 * Mirrors me-endpoints.test.ts's setup/imports pattern for
 * member-session-authenticated requests.
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
): Promise<{ organizationId: string; userId: string; memberId: string }> {
  const organizationId = await insertOrganization(env.DB, `Org for ${email}`);
  const userId = await insertUser(env.DB, email);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, category);
  await addRepresentative(env.DB, memberId, userId);

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

  return { organizationId, userId, memberId };
}

describe("POST /api/v1/me/organization/members — self-service coworker enrollment", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets the primary contact add a coworker as a new representative of the same organization", async () => {
    const { memberId, userId } = await seedOrgWithContact("primary@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "coworker-happy-token");

    const response = await call(token, "/api/v1/me/organization/members", {
      method: "POST",
      body: JSON.stringify({ name: "New Coworker", email: "coworker@example.test" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      representativeId: string;
      membershipId: string;
      userId: string;
      name: string;
      email: string;
    };
    expect(body.name).toBe("New Coworker");
    expect(body.email).toBe("coworker@example.test");
    expect(body.membershipId).toBe(memberId);

    // The coworker gets an organization_representatives row against the
    // SAME aggregate, not a new members row.
    const repRows = await queryAll<{ id: string; member_id: string; left_at: string | null }>(
      env.DB,
      "SELECT id, member_id, left_at FROM organization_representatives WHERE user_id = ?",
      body.userId,
    );
    expect(repRows).toHaveLength(1);
    expect(body.representativeId).toBe(repRows[0].id);
    expect(repRows[0].member_id).toBe(memberId);
    expect(repRows[0].left_at).toBeNull();

    const memberRows = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM members WHERE user_id = ?",
      body.userId,
    );
    expect(Number(memberRows[0].total)).toBe(0);
  });

  it("lets the secondary contact add a coworker too", async () => {
    const { userId } = await seedOrgWithContact("secondary@example.test", "A", { contactSlot: "secondary" });
    const token = await createMemberSession(env.DB, userId, "coworker-secondary-token");

    const response = await call(token, "/api/v1/me/organization/members", {
      method: "POST",
      body: JSON.stringify({ name: "Another Coworker", email: "another-coworker@example.test" }),
    });

    expect(response.status).toBe(200);
  });

  it("rejects a non-contact org member with 403", async () => {
    const { memberId } = await seedOrgWithContact("primary2@example.test", "F");
    // A second representative of the same org who is neither primary nor secondary contact.
    const nonContactUserId = await insertUser(env.DB, "non-contact@example.test");
    await addRepresentative(env.DB, memberId, nonContactUserId);
    const token = await createMemberSession(env.DB, nonContactUserId, "non-contact-token");

    const response = await call(token, "/api/v1/me/organization/members", {
      method: "POST",
      body: JSON.stringify({ name: "Should Fail", email: "should-fail@example.test" }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_ORG_CONTACT");
  });

  it("rejects an org-less individual member with 403", async () => {
    const { userId } = await insertIndividualMember(env.DB, "H6", "individual@example.test");
    const token = await createMemberSession(env.DB, userId, "individual-token");

    const response = await call(token, "/api/v1/me/organization/members", {
      method: "POST",
      body: JSON.stringify({ name: "Should Fail", email: "should-fail-2@example.test" }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NO_ORGANIZATION");
  });

  it("rejects an email that is already an active representative of this same organization with 409", async () => {
    const { memberId, userId } = await seedOrgWithContact("primary3@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "already-member-token");
    // Someone already an active representative of this exact organization.
    const existingRepUserId = await insertUser(env.DB, "existing-rep@example.test");
    await addRepresentative(env.DB, memberId, existingRepUserId);

    const response = await call(token, "/api/v1/me/organization/members", {
      method: "POST",
      body: JSON.stringify({ name: "Existing Rep", email: "existing-rep@example.test" }),
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ALREADY_MEMBER");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const response = await app.fetch(
      new Request("https://app.test/api/v1/me/organization/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Nobody", email: "nobody@example.test" }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(401);
  });
});
