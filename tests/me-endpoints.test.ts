/**
 * me-endpoints.test.ts
 *
 * member self-service: profile get/update, organization
 * visibility, headshot upload/removal, application history, votes history,
 * and authentication.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import app from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { seedOrganizationAggregate, addRepresentative, insertIndividualMembershipForUser } from "./helpers/membership";
import { seedMemberApplication } from "./helpers/member-applications";
import { myApplicationsListResponseSchema, myProfileSchema } from "../assets/shared/schemas/me";
import {
  findEligibleMemberById,
  guardMemberSessionMutationDatabase,
  requireMemberFromRequest,
} from "../functions/_lib/auth/member";
import { updateMyProfile } from "../functions/_lib/services/member-self-service";
import { mutateBeforeMatchingQuery, mutateBeforeNextBatch } from "./helpers/database-races";
import {
  getUserHeadshotRecord,
  removeUserHeadshotForRequest,
  removeUserHeadshot,
  userHeadshotTargetGuard,
} from "../functions/_lib/services/user-headshot";

function requestWithAuth(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return callApi(env, requestWithAuth(token, path, init));
}

const INDIVIDUAL_CATEGORIES = new Set(["H5", "H6", "H7"]);

async function insertActiveMember(email: string, category: string): Promise<string> {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, active, created_at, updated_at)
     VALUES (?, ?, ?, 'Test', 1, datetime('now'), datetime('now'))`,
  )
    .bind(userId, email, email)
    .run();

  if (INDIVIDUAL_CATEGORIES.has(category)) {
    await insertIndividualMembershipForUser(env.DB, userId, category);
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
    await env.DB.prepare(
      "UPDATE identities SET job_title = 'Security architect' WHERE user_id = ? AND organization_id IS NOT NULL",
    )
      .bind(userId)
      .run();
    await env.DB.prepare("UPDATE users SET headshot_r2_key = 'headshots/test-headshot.png' WHERE id = ?")
      .bind(userId)
      .run();
    const token = await createMemberSession(env.DB, userId, "me-profile-token");

    const response = await call(token, "/api/v1/users/current");
    expect(response.status).toBe(200);
    const body = myProfileSchema.parse(await response.json());
    expect(body.email).toBe("me@example.test");
    expect(body.membershipCategory).toBe("F");
    expect(body.organizationId).not.toBeNull();
    expect(body.organizationIdentities?.find((identity) => identity.userId === userId)).toMatchObject({
      jobTitle: "Security architect",
      headshotUrl: `/api/v1/users/${userId}/headshots/test-headshot.png`,
    });
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

    // An organization identity saved before the job-title rule stays readable, but its next edit needs the title.
    const untitled = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ showOnOrgProfile: false }),
    });
    expect(untitled.status).toBe(400);
    expect(await untitled.json()).toMatchObject({
      error: { details: { fieldErrors: { jobTitle: ["Enter your job title at this organization."] } } },
    });
    // A name-only save leaves the profile alone, so the missing title does not hold it back.
    const renamed = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ firstName: "Renamed" }),
    });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    const response = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ showOnOrgProfile: false, jobTitle: "Program lead" }),
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

  it("queues public name changes through the owner's form, but not unchanged or preferred-only saves", async () => {
    const userId = await insertActiveMember("name-publication@example.test", "H6");
    const token = await createMemberSession(env.DB, userId, "name-publication-token");
    const save = async (body: unknown) => {
      const response = await call(token, "/api/v1/users/current", { method: "PATCH", body: JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBe(200);
      return myProfileSchema.parse(await response.json());
    };
    expect(await save({ firstName: "Published", lastName: "Member" })).toMatchObject({
      firstName: "Published",
      lastName: "Member",
    });
    expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual([
      { resource_id: userId, reason_code: "user_profile_changed" },
    ]);
    await save({ firstName: "Published", lastName: "Member" });
    await save({ preferredName: "Preferred" });
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(1);
  });

  it("queues roster removal and restoration, while hidden edits and no-ops stay quiet", async () => {
    const userId = await insertActiveMember("roster-publication@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "roster-publication-token");
    await env.DB.prepare("UPDATE identities SET job_title='Researcher' WHERE user_id=?").bind(userId).run();
    const save = async (body: unknown) => {
      const response = await call(token, "/api/v1/users/current", { method: "PATCH", body: JSON.stringify(body) });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    const count = () =>
      env.DB.prepare("SELECT COUNT(*) AS count FROM site_publication_requests").first<number>("count");
    await save({ showOnOrgProfile: false });
    expect(await count()).toBe(1);
    await save({ biography: "Not on the member page", links: ["https://example.test/private"] });
    expect(await count()).toBe(1);
    await save({ showOnOrgProfile: true });
    expect(await count()).toBe(2);
    await save({
      showOnOrgProfile: true,
      biography: "Not on the member page",
      links: ["https://example.test/private"],
    });
    expect(await count()).toBe(2);
    await save({ biography: "New public biography" });
    expect(await count()).toBe(3);
    await save({ emailId: null });
    expect(await count()).toBe(3);
  });

  it.each(["audit_log", "site_publication_requests"] as const)(
    "rolls back a public profile and its request when %s refuses the transaction",
    async (table) => {
      const userId = await insertActiveMember("profile-atomic@example.test", "F");
      const token = await createMemberSession(env.DB, userId, "profile-atomic-token");
      await env.DB.prepare("UPDATE identities SET job_title='Original role' WHERE user_id=?").bind(userId).run();
      await env.DB.prepare(`CREATE TRIGGER fail_profile_publication BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PROFILE_TRANSACTION_FAILURE'); END`).run();
      try {
        const response = await call(token, "/api/v1/users/current", {
          method: "PATCH",
          body: JSON.stringify({
            firstName: "Must roll back",
            jobTitle: "Must roll back",
            biography: "Must roll back",
          }),
        });
        expect(response.status).toBe(500);
        expect(await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(userId).first("first_name")).toBe(
          "Test",
        );
        expect(
          await env.DB.prepare("SELECT job_title,biography FROM identities WHERE user_id=?").bind(userId).first(),
        ).toMatchObject({ job_title: "Original role", biography: null });
        expect(await env.DB.prepare("SELECT COUNT(*) FROM site_publication_requests").first<number>("COUNT(*)")).toBe(
          0,
        );
        expect(
          await env.DB.prepare("SELECT COUNT(*) FROM audit_log WHERE action='identity_profile_updated'").first<number>(
            "COUNT(*)",
          ),
        ).toBe(0);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_profile_publication").run();
      }
    },
  );

  it("leaves no publication intent when a concurrent identity edit wins", async () => {
    const userId = await insertActiveMember("profile-cas@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "profile-cas-token");
    await env.DB.prepare("UPDATE identities SET job_title='Original role' WHERE user_id=?").bind(userId).run();
    const request = requestWithAuth(token, "/api/v1/users/current");
    const member = await requireMemberFromRequest(env.DB, request, env);
    const racingDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE identities"),
      () =>
        env.DB.prepare(
          "UPDATE identities SET biography='Concurrent winner',updated_at='2099-01-01T00:00:00.000Z' WHERE user_id=?",
        )
          .bind(userId)
          .run(),
    );
    await expect(
      updateMyProfile(guardMemberSessionMutationDatabase(racingDb, member), member, {
        biography: "Losing edit",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await env.DB.prepare("SELECT biography FROM identities WHERE user_id=?").bind(userId).first("biography"),
    ).toBe("Concurrent winner");
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='identity_profile_updated'")).toHaveLength(0);
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
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'identity_profile_updated'"),
    ).resolves.toHaveLength(0);
  });

  it("keeps an individual identity's job title as the person's individual title and clears it with an empty value", async () => {
    const userId = await insertActiveMember("individual-title@example.test", "H6");
    const token = await createMemberSession(env.DB, userId, "individual-title-token");

    const saved = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ jobTitle: "Independent Consultant" }),
    });
    expect(saved.status).toBe(200);
    expect(myProfileSchema.parse(await saved.json()).jobTitle).toBe("Independent Consultant");
    expect(await queryAll(env.DB, "SELECT job_title FROM individual_job_titles WHERE user_id = ?", userId)).toEqual([
      { job_title: "Independent Consultant" },
    ]);
    const [audit] = await queryAll<{ entity_type: string; details_json: string }>(
      env.DB,
      "SELECT entity_type, details_json FROM audit_log WHERE action = 'identity_profile_updated'",
    );
    expect(audit.entity_type).toBe("identity");
    expect(JSON.parse(audit.details_json).jobTitle).toEqual({ from: null, to: "Independent Consultant" });

    const cleared = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ jobTitle: "" }),
    });
    expect(cleared.status).toBe(200);
    expect(myProfileSchema.parse(await cleared.json()).jobTitle).toBeNull();
    expect(await queryAll(env.DB, "SELECT user_id FROM individual_job_titles WHERE user_id = ?", userId)).toEqual([]);
  });

  it("audits an organization identity edit with the values it replaced", async () => {
    const userId = await insertActiveMember("identity-audit@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "identity-audit-token");
    await call(token, "/api/v1/users/current", { method: "PATCH", body: JSON.stringify({ jobTitle: "CTO" }) });
    await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ jobTitle: "CEO", biography: "Leads the company" }),
    });

    const rows = await queryAll<{ entity_id: string; details_json: string }>(
      env.DB,
      "SELECT entity_id, details_json FROM audit_log WHERE action = 'identity_profile_updated' ORDER BY created_at, rowid",
    );
    expect(rows).toHaveLength(2);
    const [identity] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM identities WHERE user_id = ? AND ended_at IS NULL",
      userId,
    );
    expect(rows[1].entity_id).toBe(identity.id);
    expect(JSON.parse(rows[1].details_json)).toMatchObject({
      jobTitle: { from: "CTO", to: "CEO" },
      biography: { from: null, to: "Leads the company" },
    });
  });

  it("gives a selected work address to the identity and refuses one another identity of the person owns", async () => {
    const userId = await insertActiveMember("work-address@example.test", "F");
    const token = await createMemberSession(env.DB, userId, "work-address-token");
    const [identity] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM identities WHERE user_id = ? AND ended_at IS NULL",
      userId,
    );
    const workEmailId = crypto.randomUUID();
    const formerEmailId = crypto.randomUUID();
    const formerOrganizationId = crypto.randomUUID();
    const formerIdentityId = crypto.randomUUID();
    const at = "2026-01-01T00:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(workEmailId, userId, "work@example.test", "work@example.test", at, at),
      env.DB.prepare(
        "INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, 'Former Org', 'former org', ?, ?)",
      ).bind(formerOrganizationId, at, at),
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, source, invited_at, started_at, ended_at, created_at, updated_at)
         VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ?)`,
      ).bind(formerIdentityId, userId, formerOrganizationId, at, at, at, at, at),
      env.DB.prepare(
        "INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, identity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(formerEmailId, userId, "former@example.test", "former@example.test", at, formerIdentityId, at),
    ]);

    const selected = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ emailId: workEmailId, jobTitle: "Program lead" }),
    });
    expect(selected.status).toBe(200);
    const profile = myProfileSchema.parse(await selected.json());
    expect(profile.emailAddresses.find((address) => address.id === workEmailId)?.identityId).toBe(identity.id);
    expect(profile.emailAddresses.find((address) => address.id === formerEmailId)?.identityId).toBe(formerIdentityId);

    const refused = await call(token, "/api/v1/users/current", {
      method: "PATCH",
      body: JSON.stringify({ emailId: formerEmailId }),
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error?: { code?: string } }).error?.code).toBe(
      "IDENTITY_EMAIL_OWNED_BY_OTHER_IDENTITY",
    );
    expect(await queryAll(env.DB, "SELECT email_id FROM identities WHERE id = ?", identity.id)).toEqual([
      { email_id: workEmailId },
    ]);
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
      stage: "processing",
    });

    const response = await call(token, "/api/v1/users/current/applications");
    expect(response.status).toBe(200);
    const body = myApplicationsListResponseSchema.parse(await response.json());
    expect(body.applications).toHaveLength(2);
    expect(body.applications.map((application) => application.stage)).toEqual(
      expect.arrayContaining(["approved", "processing"]),
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
      `INSERT INTO users (id, email, normalized_email, active, created_at, updated_at)
       VALUES (?, 'staff-actor@example.test', 'staff-actor@example.test', 1, datetime('now'), datetime('now'))`,
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
      stage: "processing",
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'submitted', NULL, 'Application submitted', datetime('now'))`,
      ).bind(crypto.randomUUID(), applicationId),
      env.DB.prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, 'submitted', 'processing', NULL, 'Moved to review', datetime('now'))`,
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
    expect(body.stage).toBe("processing");
    expect(body.timeline).toHaveLength(2);
    expect(body.timeline[0].toStage).toBe("submitted");
    expect(body.timeline[1].toStage).toBe("processing");
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

/**
 * A headshot the member uploaded is theirs to take down again. The removal is
 * two durable effects behind one request — the D1 pointer that makes the image
 * reachable, and the stored object itself — so what is asserted here is that
 * the pointer goes first and the object follows, and that a caller who is not
 * the owner (or whose record moved underneath them) changes neither.
 */
class FakeUploadsBucket {
  private readonly objects = new Map<string, ArrayBuffer>();

  async put(key: string, value: ArrayBuffer): Promise<void> {
    this.objects.set(key, value);
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number } | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { size: stored.byteLength, arrayBuffer: async () => stored };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

async function seedMemberWithHeadshot(
  email: string,
  token: string,
): Promise<{ userId: string; sessionToken: string; bucket: FakeUploadsBucket; key: string }> {
  const userId = await insertActiveMember(email, "F");
  const sessionToken = await createMemberSession(env.DB, userId, token);
  const bucket = new FakeUploadsBucket();
  const key = `headshots/${userId}/stored.jpg`;
  await bucket.put(key, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer);
  await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(key, userId).run();
  return { userId, sessionToken, bucket, key };
}

async function storedHeadshotKey(userId: string): Promise<string | null> {
  const [row] = await queryAll<{ headshot_r2_key: string | null }>(
    env.DB,
    "SELECT headshot_r2_key FROM users WHERE id = ?",
    userId,
  );
  return row.headshot_r2_key;
}

describe("Current-user headshot removal", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("clears the caller's own pointer, audits the member as the actor, and deletes the stored object", async () => {
    const { userId, sessionToken, bucket, key } = await seedMemberWithHeadshot(
      "headshot-remove@example.test",
      "headshot-remove-token",
    );
    const background: Promise<unknown>[] = [];

    const response = await app.fetch(
      requestWithAuth(sessionToken, "/api/v1/users/current/headshot", { method: "DELETE" }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: (promise: Promise<unknown>) => background.push(promise),
      } as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    // The pointer is gone before the object is, so the image stops being
    // reachable even if the storage deletion is still queued.
    expect(await storedHeadshotKey(userId)).toBeNull();
    expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual([
      { resource_id: userId, reason_code: "user_headshot_changed" },
    ]);
    expect(
      await queryAll<{ actor_type: string; actor_id: string }>(
        env.DB,
        "SELECT actor_type, actor_id FROM audit_log WHERE entity_id = ? AND action = 'headshot_removed'",
        userId,
      ),
    ).toEqual([{ actor_type: "member", actor_id: userId }]);

    await Promise.all(background);
    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM storage_deletion_outbox WHERE object_key = ?",
        key,
      ),
    ).toEqual([{ status: "deleted" }]);
  });

  it("retains the portrait and deletion state when its publication request cannot commit", async () => {
    const { userId, bucket, key } = await seedMemberWithHeadshot(
      "headshot-publication-atomic@example.test",
      "headshot-publication-atomic",
    );
    await env.DB.prepare(`CREATE TRIGGER fail_headshot_publication BEFORE INSERT ON site_publication_requests
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_HEADSHOT_PUBLICATION_FAILURE'); END`).run();
    try {
      await expect(
        removeUserHeadshot({
          db: env.DB,
          userId,
          previousKey: key,
          audit: { actorType: "member", actorId: userId, action: "headshot_removed" },
        }),
      ).rejects.toThrow("SYNTHETIC_HEADSHOT_PUBLICATION_FAILURE");
      expect(await storedHeadshotKey(userId)).toBe(key);
      expect(bucket.keys()).toEqual([key]);
      expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='headshot_removed'")).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_headshot_publication").run();
    }
  });

  it("succeeds without a stored object for a member who has no headshot on file", async () => {
    const userId = await insertActiveMember("headshot-remove-empty@example.test", "F");
    const sessionToken = await createMemberSession(env.DB, userId, "headshot-remove-empty-token");

    const response = await app.fetch(
      requestWithAuth(sessionToken, "/api/v1/users/current/headshot", { method: "DELETE" }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: new FakeUploadsBucket() },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(await storedHeadshotKey(userId)).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox")).toEqual([]);
  });

  it("refuses an anonymous caller and leaves the headshot in place", async () => {
    const { userId, bucket, key } = await seedMemberWithHeadshot(
      "headshot-remove-anon@example.test",
      "headshot-remove-anon-token",
    );

    const response = await app.fetch(
      new Request("https://app.test/api/v1/users/current/headshot", { method: "DELETE" }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(401);
    expect(await storedHeadshotKey(userId)).toBe(key);
    expect(bucket.keys()).toEqual([key]);
  });

  it("refuses to clear a pointer that moved between the route's read and its commit", async () => {
    const { userId, sessionToken, bucket, key } = await seedMemberWithHeadshot(
      "headshot-remove-race@example.test",
      "headshot-remove-race-token",
    );
    const request = requestWithAuth(sessionToken, "/api/v1/users/current/headshot", { method: "DELETE" });
    const user = await getUserHeadshotRecord(env.DB, userId);
    const replacementKey = `headshots/${userId}/replacement.jpg`;
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET headshot_r2_key = ?, updated_at = ? WHERE id = ?")
        .bind(replacementKey, "2099-01-01T00:00:00.000Z", userId)
        .run(),
    );

    await expect(
      removeUserHeadshotForRequest(racingDb, env as any, request, () => {}, {
        userId,
        previousKey: user.headshot_r2_key,
        audit: { actorType: "member", actorId: userId, action: "headshot_removed" },
        commitGuard: userHeadshotTargetGuard(user),
      }),
    ).rejects.toMatchObject({ status: 409, code: "HEADSHOT_CHANGED" });

    // The winning replacement stands, and nothing was queued for deletion on
    // behalf of the request that lost.
    expect(await storedHeadshotKey(userId)).toBe(replacementKey);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
    expect(bucket.keys()).toEqual([key]);
    expect(await queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox")).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'headshot_removed'", userId),
    ).toEqual([]);
  });
});
