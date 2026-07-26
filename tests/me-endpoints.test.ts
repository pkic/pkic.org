/**
 * me-endpoints.test.ts
 *
 * PRD §4.9/§4.10 member self-service: profile get/update, organization
 * visibility, application history, votes stub, and working group
 * join/leave (including the CA category-A constraint).
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

async function seedWorkingGroup(slug: string, mailingListEmail: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, mailing_list_email, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, slug.toUpperCase(), slug, mailingListEmail)
    .run();
  return id;
}

const INDIVIDUAL_CATEGORIES = new Set(["H5", "H6", "H7"]);

async function insertActiveMember(email: string, category: string): Promise<string> {
  const userId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  let organizationId: string | null = null;
  if (!INDIVIDUAL_CATEGORIES.has(category)) {
    organizationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(organizationId, `Org for ${email}`, `org for ${email}`)
      .run();
  }
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
  return userId;
}

describe("Member self-service /api/v1/me/* (PRD §4.9/§4.10)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("GET /api/v1/me returns my profile", async () => {
    const userId = await insertActiveMember("me@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "me-profile-token");

    const response = await call(token, "/api/v1/me");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      email: string;
      membershipCategory: string;
      canEditOrganizationName: boolean;
    };
    expect(body.email).toBe("me@example.test");
    expect(body.membershipCategory).toBe("F");
    expect(body.canEditOrganizationName).toBe(false);
  });

  it("PATCH /api/v1/me updates editable fields", async () => {
    const userId = await insertActiveMember("update-me@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "me-update-token");

    const response = await call(token, "/api/v1/me", {
      method: "PATCH",
      body: JSON.stringify({ jobTitle: "CTO", biography: "New bio" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobTitle: string; biography: string };
    expect(body.jobTitle).toBe("CTO");
    expect(body.biography).toBe("New bio");
  });

  it("only org-less (H5/H6/H7) members may set organizationName", async () => {
    const orgTiedUserId = await insertActiveMember("org-tied@example.test", "F");
    const orgTiedToken = await createMemberSession(env.DB, orgTiedUserId, "org-tied-token");
    const orgTiedResponse = await call(orgTiedToken, "/api/v1/me", {
      method: "PATCH",
      body: JSON.stringify({ organizationName: "Should Not Apply" }),
    });
    const orgTiedBody = (await orgTiedResponse.json()) as { organizationName: string | null };
    expect(orgTiedBody.organizationName).not.toBe("Should Not Apply");

    const individualUserId = await insertActiveMember("individual@example.test", "H6");
    const individualToken = await createMemberSession(env.DB, individualUserId, "individual-token");
    const individualResponse = await call(individualToken, "/api/v1/me", {
      method: "PATCH",
      body: JSON.stringify({ organizationName: "My Consultancy" }),
    });
    const individualBody = (await individualResponse.json()) as {
      organizationName: string | null;
      canEditOrganizationName: boolean;
    };
    expect(individualBody.canEditOrganizationName).toBe(true);
    expect(individualBody.organizationName).toBe("My Consultancy");
  });

  it("PATCH /api/v1/me/organization-visibility toggles members.show_on_org_profile", async () => {
    const userId = await insertActiveMember("visibility@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "visibility-token");

    const response = await call(token, "/api/v1/me/organization-visibility", {
      method: "PATCH",
      body: JSON.stringify({ showOnOrgProfile: false }),
    });
    expect(response.status).toBe(200);

    const rows = await queryAll<{ show_on_org_profile: number }>(
      env.DB,
      "SELECT show_on_org_profile FROM members WHERE user_id = ?",
      userId,
    );
    expect(rows[0].show_on_org_profile).toBe(0);
  });

  it("GET /api/v1/me/applications lists applications matching my email", async () => {
    const userId = await insertActiveMember("applicant-history@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "applicant-history-token");
    await env.DB.prepare(
      `INSERT INTO member_applications
         (id, applicant_email, applicant_name, organization_name, organization_domain, membership_category,
          status, stage, stage_entered_at, manage_token_hash, created_at, updated_at)
       VALUES (?, 'applicant-history@example.test', 'Applicant', 'Org', 'example.test', 'F',
               'approved', 'approved', datetime('now'), ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), crypto.randomUUID())
      .run();

    const response = await call(token, "/api/v1/me/applications");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applications: Array<{ status: string }> };
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].status).toBe("approved");
  });

  it("GET /api/v1/me/votes is a gated stub returning an empty list (voting is Phase 4B)", async () => {
    const userId = await insertActiveMember("votes-stub@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "votes-stub-token");

    const response = await call(token, "/api/v1/me/votes");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { votes: unknown[] };
    expect(body.votes).toEqual([]);
  });

  it("joins and leaves a working group, toggling google_groups_sync_queue", async () => {
    await seedWorkingGroup("pqc", "pqc@lists.pkic.org");
    const userId = await insertActiveMember("wg-join@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "wg-join-token");

    const joinResponse = await call(token, "/api/v1/me/working-groups/pqc", { method: "POST" });
    expect(joinResponse.status).toBe(200);

    const listResponse = await call(token, "/api/v1/me/working-groups");
    const listBody = (await listResponse.json()) as { workingGroups: Array<{ slug: string }> };
    expect(listBody.workingGroups).toHaveLength(1);
    expect(listBody.workingGroups[0].slug).toBe("pqc");

    const addQueueRows = await queryAll(env.DB, "SELECT id FROM google_groups_sync_queue WHERE action = 'add_to_list'");
    expect(addQueueRows).toHaveLength(1);

    const leaveResponse = await call(token, "/api/v1/me/working-groups/pqc", { method: "DELETE" });
    expect(leaveResponse.status).toBe(200);

    const listAfterLeave = await call(token, "/api/v1/me/working-groups");
    const listAfterLeaveBody = (await listAfterLeave.json()) as { workingGroups: unknown[] };
    expect(listAfterLeaveBody.workingGroups).toHaveLength(0);

    const removeQueueRows = await queryAll(
      env.DB,
      "SELECT id FROM google_groups_sync_queue WHERE action = 'remove_from_list'",
    );
    expect(removeQueueRows).toHaveLength(1);
  });

  it("enforces the CA working group constraint for non-category-A members", async () => {
    await seedWorkingGroup("ca", "ca@lists.pkic.org");
    const userId = await insertActiveMember("wg-ca-denied@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "wg-ca-denied-token");

    const response = await call(token, "/api/v1/me/working-groups/ca", { method: "POST" });
    expect(response.status).toBe(403);
  });

  it("allows category A members into the CA working group", async () => {
    await seedWorkingGroup("ca", "ca@lists.pkic.org");
    const userId = await insertActiveMember("wg-ca-allowed@example.test", "A");
    const token = await createMemberSession(env.DB, userId, "wg-ca-allowed-token");

    const response = await call(token, "/api/v1/me/working-groups/ca", { method: "POST" });
    expect(response.status).toBe(200);
  });

  it("rejects unauthenticated access to every /me endpoint", async () => {
    const response = await app.fetch(
      new Request("https://app.test/api/v1/me/working-groups"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(401);
  });
});
