/**
 * user-organizations-feed.test.ts
 *
 * GET /api/v1/users/current/organizations — the bounded self feed of
 * organizations the current user actively represents (avatar-menu switcher
 * and dashboard). Set-based: functions/_lib/services/user-organizations.ts
 * must resolve isOrgContact/isPrimaryContact/hasPendingReview without a
 * per-organization loop.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { userOrganizationsListResponseSchema } from "../assets/shared/schemas/user-organizations";
import {
  insertUser,
  insertOrganization,
  seedOrganizationAggregate,
  addRepresentative,
  assignRepresentativeRole,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("GET /api/v1/users/current/organizations", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns every organization the caller represents with correct contact and pending-review flags, paginated", async () => {
    const userId = await insertUser(env.DB, "feed-user@example.test");

    const plainOrgId = await insertOrganization(env.DB, "Alpha Plain Org");
    const plainMemberId = await seedOrganizationAggregate(env.DB, plainOrgId, "F");
    await addRepresentative(env.DB, plainMemberId, userId);

    const contactOrgId = await insertOrganization(env.DB, "Beta Contact Org");
    const contactMemberId = await seedOrganizationAggregate(env.DB, contactOrgId, "A");
    await addRepresentative(env.DB, contactMemberId, userId);
    await assignRepresentativeRole(env.DB, contactMemberId, userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await env.DB.prepare(
      `INSERT INTO organization_content_reviews
         (id, organization_id, submitted_by_user_id, proposed_changes_json, status, submitted_at, created_at)
       VALUES (?, ?, ?, '{}', 'pending', datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), contactOrgId, userId)
      .run();

    const token = await createMemberSession(env.DB, userId, "feed-user-token");
    const response = await call(token, "/api/v1/users/current/organizations?limit=1&sort=name");
    expect(response.status).toBe(200);
    const firstPage = userOrganizationsListResponseSchema.parse(await response.json());
    expect(firstPage.page).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true });
    expect(firstPage.organizations).toEqual([
      {
        organizationId: plainOrgId,
        memberId: plainMemberId,
        name: "Alpha Plain Org",
        membershipCategory: "F",
        isOrgContact: false,
        isPrimaryContact: false,
        hasPendingReview: false,
      },
    ]);

    const secondResponse = await call(token, "/api/v1/users/current/organizations?limit=1&offset=1&sort=name");
    const secondPage = userOrganizationsListResponseSchema.parse(await secondResponse.json());
    expect(secondPage.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect(secondPage.organizations).toEqual([
      {
        organizationId: contactOrgId,
        memberId: contactMemberId,
        name: "Beta Contact Org",
        membershipCategory: "A",
        isOrgContact: true,
        isPrimaryContact: true,
        hasPendingReview: true,
      },
    ]);
  });

  it("does not mark hasPendingReview true for a non-contact even when a review is pending for their organization", async () => {
    const contactUserId = await insertUser(env.DB, "pending-review-contact@example.test");
    const plainUserId = await insertUser(env.DB, "pending-review-plain@example.test");
    const organizationId = await insertOrganization(env.DB, "Shared Org");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, contactUserId);
    await addRepresentative(env.DB, memberId, plainUserId);
    await assignRepresentativeRole(env.DB, memberId, contactUserId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await env.DB.prepare(
      `INSERT INTO organization_content_reviews
         (id, organization_id, submitted_by_user_id, proposed_changes_json, status, submitted_at, created_at)
       VALUES (?, ?, ?, '{}', 'pending', datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId, contactUserId)
      .run();

    const plainToken = await createMemberSession(env.DB, plainUserId, "pending-review-plain-token");
    const response = await call(plainToken, "/api/v1/users/current/organizations");
    const body = userOrganizationsListResponseSchema.parse(await response.json());
    expect(body.organizations).toEqual([
      expect.objectContaining({ organizationId, isOrgContact: false, hasPendingReview: false }),
    ]);
  });

  it("filters by name via q", async () => {
    const userId = await insertUser(env.DB, "search-user@example.test");
    const matchId = await insertOrganization(env.DB, "Findable Consortium");
    const matchMemberId = await seedOrganizationAggregate(env.DB, matchId, "A");
    await addRepresentative(env.DB, matchMemberId, userId);
    const otherId = await insertOrganization(env.DB, "Unrelated Group");
    const otherMemberId = await seedOrganizationAggregate(env.DB, otherId, "A");
    await addRepresentative(env.DB, otherMemberId, userId);

    const token = await createMemberSession(env.DB, userId, "search-user-token");
    const response = await call(token, "/api/v1/users/current/organizations?q=findable");
    const body = userOrganizationsListResponseSchema.parse(await response.json());
    expect(body.organizations.map((organization) => organization.organizationId)).toEqual([matchId]);
  });

  it("rejects an unauthenticated caller with 401", async () => {
    const response = await app.fetch(
      new Request("https://app.test/api/v1/users/current/organizations"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(401);
  });

  it("rejects a staff-only caller with no member capacity", async () => {
    await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    const adminToken = await createAdminSession(env.DB, adminId, "feed-staff-only-token");

    const response = await call(adminToken, "/api/v1/users/current/organizations");
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_FORBIDDEN");
  });
});
