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
  membershipCategory?: string | null;
  contactSlot?: "primary" | "secondary" | "none";
}

/** Seeds an organization with one active representative and, by default, sets that
 * representative as the primary contact. Returns both ids plus the rep's userId. */
async function seedOrgWithContact(
  email: string,
  category: string,
  { membershipCategory = category, contactSlot = "primary" }: SeedOrgOptions = {},
): Promise<{ organizationId: string; userId: string; memberId: string }> {
  const organizationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO organizations (id, name, normalized_name, membership_category, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(organizationId, `Org for ${email}`, `org for ${email}`, membershipCategory)
    .run();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, email, email),
    env.DB.prepare(
      `INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
    ).bind(memberId, category, userId, organizationId),
  ]);

  if (contactSlot === "primary") {
    await env.DB.prepare("UPDATE organizations SET primary_contact_user_id = ? WHERE id = ?")
      .bind(userId, organizationId)
      .run();
  } else if (contactSlot === "secondary") {
    // Give the org a distinct primary contact first so this user is
    // unambiguously the *secondary* contact.
    const otherPrimaryId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Other', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(otherPrimaryId, `primary-${email}`, `primary-${email}`)
      .run();
    await env.DB.prepare(
      "UPDATE organizations SET primary_contact_user_id = ?, secondary_contact_user_id = ? WHERE id = ?",
    )
      .bind(otherPrimaryId, userId, organizationId)
      .run();
  }

  return { organizationId, userId, memberId };
}

async function seedIndividualMember(email: string, category: string): Promise<string> {
  const userId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, email, email),
    env.DB.prepare(
      `INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'active', datetime('now'), datetime('now'))`,
    ).bind(memberId, category, userId),
  ]);
  return userId;
}

describe("POST /api/v1/me/organization/members — self-service coworker enrollment", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets the primary contact add a coworker, inheriting the org's membership_category", async () => {
    const { organizationId, userId } = await seedOrgWithContact("primary@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "coworker-happy-token");

    const response = await call(token, "/api/v1/me/organization/members", {
      method: "POST",
      body: JSON.stringify({ name: "New Coworker", email: "coworker@example.test" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { memberId: string; userId: string; name: string; email: string };
    expect(body.name).toBe("New Coworker");
    expect(body.email).toBe("coworker@example.test");

    const rows = await queryAll<{ member_type: string; organization_id: string; status: string }>(
      env.DB,
      "SELECT member_type, organization_id, status FROM members WHERE user_id = ?",
      body.userId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].member_type).toBe("F");
    expect(rows[0].organization_id).toBe(organizationId);
    expect(rows[0].status).toBe("active");
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
    const { organizationId } = await seedOrgWithContact("primary2@example.test", "F");
    // A second representative of the same org who is neither primary nor secondary contact.
    const nonContactUserId = crypto.randomUUID();
    const nonContactMemberId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(nonContactUserId, "non-contact@example.test", "non-contact@example.test"),
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, organization_id, status, created_at, updated_at)
         VALUES (?, 'F', ?, ?, 'active', datetime('now'), datetime('now'))`,
      ).bind(nonContactMemberId, nonContactUserId, organizationId),
    ]);
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
    const userId = await seedIndividualMember("individual@example.test", "H6");
    const token = await createMemberSession(env.DB, userId, "individual-token");

    const response = await call(token, "/api/v1/me/organization/members", {
      method: "POST",
      body: JSON.stringify({ name: "Should Fail", email: "should-fail-2@example.test" }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NO_ORGANIZATION");
  });

  it("rejects an email that already holds an active membership with 409", async () => {
    const { userId } = await seedOrgWithContact("primary3@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "already-member-token");
    // Someone already an active member elsewhere.
    await seedIndividualMember("existing-member@example.test", "H6");

    const response = await call(token, "/api/v1/me/organization/members", {
      method: "POST",
      body: JSON.stringify({ name: "Existing Member", email: "existing-member@example.test" }),
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
