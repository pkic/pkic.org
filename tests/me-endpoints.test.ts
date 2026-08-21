/**
 * me-endpoints.test.ts
 *
 * member self-service: profile get/update, organization
 * visibility, application history, votes stub, and working group
 * join/leave (including the CA category-A constraint).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { seedOrganizationAggregate, addRepresentative } from "./helpers/membership";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { seedMemberApplication } from "./helpers/member-applications";
import { myApplicationsListResponseSchema, myWorkingGroupsListResponseSchema } from "../assets/shared/schemas/me";

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
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(userId, email, email)
    .run();

  if (INDIVIDUAL_CATEGORIES.has(category)) {
    const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, category, new Date().toISOString());
    await env.DB.batch(statements);
    return userId;
  }

  const organizationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(organizationId, `Org for ${email}`, `org for ${email}`)
    .run();
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, category);
  await addRepresentative(env.DB, memberId, userId);
  return userId;
}

describe("Member self-service /api/v1/me/*", () => {
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

  it("PATCH /api/v1/me/organization-visibility toggles organization_representatives.show_on_org_profile", async () => {
    const userId = await insertActiveMember("visibility@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "visibility-token");

    const response = await call(token, "/api/v1/me/organization-visibility", {
      method: "PATCH",
      body: JSON.stringify({ showOnOrgProfile: false }),
    });
    expect(response.status).toBe(200);

    const rows = await queryAll<{ show_on_org_profile: number }>(
      env.DB,
      "SELECT show_on_org_profile FROM organization_representatives WHERE user_id = ? AND left_at IS NULL",
      userId,
    );
    expect(rows[0].show_on_org_profile).toBe(0);
  });

  it("GET /api/v1/me/applications lists applications matching my email", async () => {
    const userId = await insertActiveMember("applicant-history@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "applicant-history-token");
    await seedMemberApplication({
      applicantEmail: "applicant-history@example.test",
      applicantName: "Applicant",
      organizationName: "Org",
      organizationDomain: "example.test",
      membershipCategory: "F",
      stage: "approved",
    });

    const response = await call(token, "/api/v1/me/applications");
    expect(response.status).toBe(200);
    const body = myApplicationsListResponseSchema.parse(await response.json());
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].stage).toBe("approved");
    expect(body.page).toEqual({ limit: 25, offset: 0, total: 1, hasMore: false });

    const invalid = await call(token, "/api/v1/me/applications?sort=email");
    expect(invalid.status).toBe(400);
  });

  it("GET /api/v1/me/applications/:id returns the applicant-facing detail (timeline + communications), scoped to my own email", async () => {
    const userId = await insertActiveMember("applicant-detail@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "applicant-detail-token");
    const staffUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'staff-actor@example.test', 'staff-actor@example.test', 'admin', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffUserId)
      .run();
    const applicationId = await seedMemberApplication({
      applicantEmail: "applicant-detail@example.test",
      applicantName: "Applicant Detail",
      organizationName: "Org",
      organizationDomain: "example.test",
      membershipCategory: "F",
      stage: "in_review",
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'pending', NULL, 'Application submitted', datetime('now'))`,
      ).bind(crypto.randomUUID(), applicationId),
      env.DB.prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, 'pending', 'in_review', NULL, 'Moved to review', datetime('now'))`,
      ).bind(crypto.randomUUID(), applicationId),
      env.DB.prepare(
        `INSERT INTO application_communications (id, application_id, kind, actor_user_id, subject, body, template_key, email_outbox_id, created_at)
         VALUES (?, ?, 'communication', ?, 'Welcome', 'Thanks for applying', NULL, NULL, datetime('now'))`,
      ).bind(crypto.randomUUID(), applicationId, staffUserId),
      env.DB.prepare(
        `INSERT INTO application_communications (id, application_id, kind, actor_user_id, subject, body, template_key, email_outbox_id, created_at)
         VALUES (?, ?, 'note', ?, NULL, 'Internal staff note — do not leak', NULL, NULL, datetime('now'))`,
      ).bind(crypto.randomUUID(), applicationId, staffUserId),
    ]);

    const response = await call(token, `/api/v1/me/applications/${applicationId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      stage: string;
      timeline: Array<{ toStage: string }>;
      communications: Array<{ body: string }>;
    };
    expect(body.stage).toBe("in_review");
    expect(body.timeline).toHaveLength(2);
    expect(body.timeline[0].toStage).toBe("pending");
    expect(body.timeline[1].toStage).toBe("in_review");
    expect(body.communications).toHaveLength(1);
    expect(body.communications[0].body).toBe("Thanks for applying");
    expect(body.communications.some((c) => c.body.includes("Internal staff note"))).toBe(false);

    const otherUserId = await insertActiveMember("not-the-applicant@example.test", "F");
    const otherToken = await createMemberSession(env.DB, otherUserId, "not-the-applicant-token");
    const deniedResponse = await call(otherToken, `/api/v1/me/applications/${applicationId}`);
    expect(deniedResponse.status).toBe(404);
  });

  it("GET/PATCH /api/v1/me/notification-preferences defaults to all-true and persists partial updates", async () => {
    const userId = await insertActiveMember("notif-prefs@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "notif-prefs-token");

    const getResponse = await call(token, "/api/v1/me/notification-preferences");
    expect(getResponse.status).toBe(200);
    const defaults = await getResponse.json();
    expect(defaults).toEqual({
      workingGroupUpdates: true,
      voteReminders: true,
      generalAnnouncements: true,
      wgChairMembershipDigest: true,
    });

    const patchResponse = await call(token, "/api/v1/me/notification-preferences", {
      method: "PATCH",
      body: JSON.stringify({ voteReminders: false }),
    });
    expect(patchResponse.status).toBe(200);
    const patched = await patchResponse.json();
    expect(patched).toEqual({
      workingGroupUpdates: true,
      voteReminders: false,
      generalAnnouncements: true,
      wgChairMembershipDigest: true,
    });

    // Persisted, not just returned — a second GET reflects the same state.
    const getAfterResponse = await call(token, "/api/v1/me/notification-preferences");
    expect(await getAfterResponse.json()).toEqual(patched);
  });

  it("GET /api/v1/me returns headshotUrl derived from headshot_r2_key", async () => {
    const userId = await insertActiveMember("headshot-profile@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "headshot-profile-token");

    const beforeResponse = await call(token, "/api/v1/me");
    expect(((await beforeResponse.json()) as { headshotUrl: string | null }).headshotUrl).toBeNull();

    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?")
      .bind(`headshots/${userId}/123.jpg`, userId)
      .run();

    const afterResponse = await call(token, "/api/v1/me");
    const afterBody = (await afterResponse.json()) as { headshotUrl: string | null };
    expect(afterBody.headshotUrl).toBe(`/api/v1/headshots/${userId}/123.jpg`);
  });

  it("GET /api/v1/me/votes is a gated stub returning an empty list", async () => {
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

  it("selects the eligible working-group catalog in the backend", async () => {
    await seedWorkingGroup("ca", "ca@lists.pkic.org");
    await seedWorkingGroup("pqc", "pqc@lists.pkic.org");
    const categoryFUserId = await insertActiveMember("wg-catalog-f@example.test", "F");
    const categoryAUserId = await insertActiveMember("wg-catalog-a@example.test", "A");

    const categoryFBody = myWorkingGroupsListResponseSchema.parse(
      await (
        await call(
          await createMemberSession(env.DB, categoryFUserId, "wg-catalog-f-token"),
          "/api/v1/me/working-groups",
        )
      ).json(),
    );
    expect(categoryFBody.availableWorkingGroups.map((group) => group.slug)).toEqual(["pqc"]);

    const categoryABody = myWorkingGroupsListResponseSchema.parse(
      await (
        await call(
          await createMemberSession(env.DB, categoryAUserId, "wg-catalog-a-token"),
          "/api/v1/me/working-groups",
        )
      ).json(),
    );
    expect(categoryABody.availableWorkingGroups.map((group) => group.slug).sort()).toEqual(["ca", "pqc"]);
  });

  it("rejects direct joins to inactive working groups", async () => {
    const workingGroupId = await seedWorkingGroup("inactive", null);
    await env.DB.prepare("UPDATE working_groups SET active = 0 WHERE id = ?").bind(workingGroupId).run();
    const userId = await insertActiveMember("wg-inactive@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "wg-inactive-token");

    const response = await call(token, "/api/v1/me/working-groups/inactive", { method: "POST" });
    expect(response.status).toBe(409);
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
