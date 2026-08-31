/**
 * me-endpoints.test.ts
 *
 * member self-service: profile get/update, organization
 * visibility, application history, votes history, and authentication.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { seedOrganizationAggregate, addRepresentative } from "./helpers/membership";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { seedMemberApplication } from "./helpers/member-applications";
import { myApplicationsListResponseSchema, myProfileSchema } from "../assets/shared/schemas/me";
import {
  findEligibleMemberById,
  guardMemberSessionMutationDatabase,
  requireMemberFromRequest,
} from "../functions/_lib/auth/member";
import { updateMyProfile } from "../functions/_lib/services/member-self-service";
import { mutateBeforeNextBatch } from "./helpers/database-races";

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
    const now = new Date().toISOString();
    const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, category, now);
    const identity = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId: null,
      source: "staff",
      startImmediately: true,
      now,
    });
    await env.DB.batch([...statements, identity.statement]);
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

describe("Current-user and application self-service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("GET /api/v1/users/current returns my profile", async () => {
    const userId = await insertActiveMember("me@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "me-profile-token");

    const response = await call(token, "/api/v1/users/current");
    expect(response.status).toBe(200);
    const body = myProfileSchema.parse(await response.json());
    expect(body.email).toBe("me@example.test");
    expect(body.membershipCategory).toBe("F");
    expect(body.organizationId).not.toBeNull();
  });

  it("PATCH /api/v1/users/current updates editable fields", async () => {
    const userId = await insertActiveMember("update-me@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "me-update-token");

    const response = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ jobTitle: "CTO", biography: "New bio" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobTitle: string; biography: string };
    expect(body.jobTitle).toBe("CTO");
    expect(body.biography).toBe("New bio");
  });

  it("does not allow users to invent an organization affiliation on any identity", async () => {
    const orgTiedUserId = await insertActiveMember("org-tied@example.test", "F");
    const orgTiedToken = await createMemberSession(env.DB, orgTiedUserId, "org-tied-token");
    const orgTiedResponse = await call(orgTiedToken, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ organizationName: "Should Not Apply" }),
    });
    const orgTiedBody = (await orgTiedResponse.json()) as { organizationName: string | null };
    expect(orgTiedBody.organizationName).not.toBe("Should Not Apply");

    const individualUserId = await insertActiveMember("individual@example.test", "H6");
    const individualToken = await createMemberSession(env.DB, individualUserId, "individual-token");
    const individualResponse = await call(individualToken, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ organizationName: "My Consultancy" }),
    });
    const individualBody = myProfileSchema.parse(await individualResponse.json());
    expect(individualBody.organizationId).toBeNull();
    expect(individualBody.organizationName).toBeNull();
  });

  it("PATCH /api/v1/users/current updates organization identity visibility with the profile", async () => {
    const userId = await insertActiveMember("visibility@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "visibility-token");

    const response = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ showOnOrgProfile: false }),
    });
    expect(response.status).toBe(200);
    expect(myProfileSchema.parse(await response.json()).showOnOrgProfile).toBe(false);

    const rows = await queryAll<{ show_on_organization_profile: number }>(
      env.DB,
      `SELECT show_on_organization_profile FROM identities
        WHERE user_id = ? AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
      userId,
    );
    expect(rows[0].show_on_organization_profile).toBe(0);
  });

  it("rolls back profile changes when the exact user session is revoked before the D1 batch", async () => {
    const userId = await insertActiveMember("profile-race@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "profile-race-token");
    const request = requestWithAuth(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ jobTitle: "Must not persist" }),
    });
    const member = await requireMemberFromRequest(env.DB, request, env);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ?").bind(userId).run(),
    );

    await expect(
      updateMyProfile(guardMemberSessionMutationDatabase(racingDb, member), member, {
        jobTitle: "Must not persist",
      }),
    ).rejects.toMatchObject({ status: 409, code: "AUTHORIZATION_CONTEXT_CHANGED" });

    const [identity] = await queryAll<{ job_title: string | null }>(
      env.DB,
      "SELECT job_title FROM identities WHERE user_id = ? AND ended_at IS NULL",
      userId,
    );
    expect(identity.job_title).toBeNull();
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'user_profile_updated'", userId),
    ).resolves.toHaveLength(0);
  });

  it("GET /api/v1/users/current/applications lists applications bound to my identity and selected capacity", async () => {
    const userId = await insertActiveMember("applicant-history@example.test", "F");
    const member = await findEligibleMemberById(env.DB, userId);
    if (!member) throw new Error("Expected active member");
    const token = await createMemberSession(env.DB, userId, "applicant-history-token");
    await seedMemberApplication({
      applicantUserId: userId,
      memberId: member.memberId,
      applicantEmail: "applicant-history@example.test",
      applicantName: "Applicant",
      organizationName: "Org",
      organizationDomain: "example.test",
      membershipCategory: "F",
      stage: "approved",
    });
    await seedMemberApplication({
      applicantUserId: userId,
      applicantEmail: "applicant-history@example.test",
      applicantName: "Applicant",
      organizationName: "Other Org",
      organizationDomain: "other.example.test",
      membershipCategory: "F",
      stage: "in_review",
    });

    const response = await call(token, "/api/v1/users/current/applications");
    expect(response.status).toBe(200);
    const body = myApplicationsListResponseSchema.parse(await response.json());
    expect(body.applications).toHaveLength(2);
    expect(body.applications.map((application) => application.stage)).toEqual(
      expect.arrayContaining(["approved", "in_review"]),
    );
    expect(body.page).toEqual({ limit: 25, offset: 0, total: 2, hasMore: false });

    const filtered = await call(token, "/api/v1/users/current/applications?q=approved&limit=1&sort=stage");
    expect(filtered.status).toBe(200);
    const filteredBody = myApplicationsListResponseSchema.parse(await filtered.json());
    expect(filteredBody.applications.map((application) => application.stage)).toEqual(["approved"]);
    expect(filteredBody.page).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });

    const invalid = await call(token, "/api/v1/users/current/applications?sort=email");
    expect(invalid.status).toBe(400);
  });

  it("GET /api/v1/users/current/applications/:id returns applicant-facing detail scoped to my Member capacity", async () => {
    const userId = await insertActiveMember("applicant-detail@example.test", "F");
    const member = await findEligibleMemberById(env.DB, userId);
    if (!member) throw new Error("Expected active member");
    const token = await createMemberSession(env.DB, userId, "applicant-detail-token");
    const staffUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'staff-actor@example.test', 'staff-actor@example.test', 'admin', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffUserId)
      .run();
    const applicationId = await seedMemberApplication({
      applicantUserId: userId,
      memberId: member.memberId,
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

    const response = await call(token, `/api/v1/users/current/applications/${applicationId}`);
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
    const deniedResponse = await call(otherToken, `/api/v1/users/current/applications/${applicationId}`);
    expect(deniedResponse.status).toBe(404);
  });

  it("uses bounded identity and Member indexes for current-user application history", async () => {
    const result = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id, stage, membership_category, created_at
         FROM member_applications
        WHERE member_id = ? OR (member_id IS NULL AND applicant_user_id = ?)
        ORDER BY created_at DESC, id ASC
        LIMIT 25`,
    )
      .bind(crypto.randomUUID(), crypto.randomUUID())
      .all<{ detail: string }>();
    const plan = result.results.map((row) => row.detail).join("\n");
    expect(plan).toContain("idx_member_applications_member_created");
    expect(plan).toContain("idx_member_applications_applicant_user");
    expect(plan).not.toMatch(/SCAN member_applications/i);
  });

  it("GET/PATCH /api/v1/users/current/notifications/preferences defaults to all-true and persists partial updates", async () => {
    const userId = await insertActiveMember("notif-prefs@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "notif-prefs-token");

    const getResponse = await call(token, "/api/v1/users/current/notifications/preferences");
    expect(getResponse.status).toBe(200);
    const defaults = await getResponse.json();
    expect(defaults).toEqual({
      workingGroupUpdates: true,
      voteReminders: true,
      generalAnnouncements: true,
      wgChairMembershipDigest: true,
    });

    const patchResponse = await call(token, "/api/v1/users/current/notifications/preferences", {
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
    const getAfterResponse = await call(token, "/api/v1/users/current/notifications/preferences");
    expect(await getAfterResponse.json()).toEqual(patched);
  });

  it("GET /api/v1/users/current returns headshotUrl derived from headshot_r2_key", async () => {
    const userId = await insertActiveMember("headshot-profile@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "headshot-profile-token");

    const beforeResponse = await call(token, "/api/v1/users/current");
    expect(((await beforeResponse.json()) as { headshotUrl: string | null }).headshotUrl).toBeNull();

    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?")
      .bind(`headshots/${userId}/123.jpg`, userId)
      .run();

    const afterResponse = await call(token, "/api/v1/users/current");
    const afterBody = (await afterResponse.json()) as { headshotUrl: string | null };
    expect(afterBody.headshotUrl).toBe(`/api/v1/users/${userId}/headshots/123.jpg`);
  });

  it("rejects unauthenticated current-user access and does not retain moved /me paths", async () => {
    const response = await app.fetch(
      new Request("https://app.test/api/v1/users/current/groups"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect((await call("invalid", "/api/v1/me/groups")).status).toBe(404);
    expect((await call("invalid", "/api/v1/me/notification-preferences")).status).toBe(404);
    expect((await call("invalid", "/api/v1/me/applications")).status).toBe(404);
  });
});
