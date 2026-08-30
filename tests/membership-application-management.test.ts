/**
 * membership-application-management.test.ts
 *
 * Canonical membership-application domain endpoints:
 *  - PATCH /api/v1/members/applications/:id (Fix 3: correct applicant-submitted
 *    fields without transitioning stage)
 *  - GET /api/v1/members/applications?sort=... (Fix 4: sortable columns)
 *  - POST /api/v1/membership/batches/:batchKey/runs
 *    (manual off-cycle triggers for the twice-weekly membership batches)
 *
 * Structure mirrors tests/admin-members.test.ts and
 * tests/application-stage-machine.test.ts.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { seedPersona } from "./personas/seed";
import { onlyPersona } from "./personas/catalog";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createApplicationFormSubmission, seedMemberApplication } from "./helpers/member-applications";
import { gateBatchGroup, gateNextBatch } from "./helpers/d1-batch-gate";
import { updateMembershipSettings } from "../functions/_lib/services/membership-settings";
import { runOnHoldReminders } from "../functions/_lib/services/membership/scheduled-jobs";
import { updateMembershipApplication } from "../functions/_lib/services/membership/applications/management";
import { submitApplicationConcern } from "../functions/_lib/services/membership/applications/queries";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { membershipApplicationsListResponseSchema } from "../assets/shared/schemas/membership-application-management";
import { membershipCategoryCatalogResponseSchema } from "../assets/shared/schemas/membership-categories";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";

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

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

async function assignRole(
  userId: string,
  roleId: string,
  grantedBy: string,
  context: { type: string; id: string } | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, context?.type ?? null, context?.id ?? null, grantedBy)
    .run();
}

async function createApplication(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const id = await seedMemberApplication({
    applicantEmail: (overrides.applicant_email as string) ?? "applicant@example.test",
    applicantName: (overrides.applicant_name as string) ?? "Applicant Name",
    organizationName: (overrides.organization_name as string) ?? "Example Org",
    organizationDomain: (overrides.organization_domain as string) ?? "example.test",
    membershipCategory: (overrides.membership_category as string) ?? "F",
    formSubmissionId: (overrides.form_submission_id as string | null) ?? null,
    stage: (overrides.stage as string) ?? "pending",
    createdAt: (overrides.created_at as string) ?? new Date().toISOString(),
  });
  return { id };
}

describe("PATCH /api/v1/members/applications/:id (Fix 3 — edit application fields)", () => {
  let adminToken: string;
  let adminId: string;
  let adminActor: UserBackedAuthAdmin;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminId = adminRow.id;
    adminActor = { identityType: "user", id: adminId, email: "admin@pkic.org", role: "admin" };
    adminToken = await createAdminSession(env.DB, adminId, "membership-application-management-token");
  });

  it("edits top-level fields and answers, without transitioning stage", async () => {
    const formSubmissionId = await createApplicationFormSubmission({
      job_title: "Engineer",
      reason: "Original reason",
    });
    const { id } = await createApplication({ form_submission_id: formSubmissionId });

    const response = await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        applicantName: "Corrected Name",
        applicantEmail: "corrected@newdomain.test",
        organizationName: "Corrected Org",
        membershipCategory: "F",
        answers: { job_title: "Senior Engineer", reason: "Updated reason" },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      applicantName: string;
      applicantEmail: string;
      organizationName: string;
      stage: string;
      answers: Record<string, unknown>;
    };
    expect(body.applicantName).toBe("Corrected Name");
    expect(body.applicantEmail).toBe("corrected@newdomain.test");
    expect(body.organizationName).toBe("Corrected Org");
    expect(body.answers.job_title).toBe("Senior Engineer");
    expect(body.answers.reason).toBe("Updated reason");
    // Stage is untouched by an edit.
    expect(body.stage).toBe("pending");

    const rows = await queryAll<{
      applicant_name: string;
      applicant_email: string;
      organization_domain: string;
      stage: string;
    }>(
      env.DB,
      "SELECT applicant_name, applicant_email, organization_domain, stage FROM member_applications WHERE id = ?",
      id,
    );
    expect(rows[0].applicant_name).toBe("Corrected Name");
    expect(rows[0].applicant_email).toBe("corrected@newdomain.test");
    // organization_domain is kept in lockstep with applicantEmail so
    // duplicate-application detection (Fix 1's subject) doesn't desync.
    expect(rows[0].organization_domain).toBe("newdomain.test");
    expect(rows[0].stage).toBe("pending");
  });

  it("fails closed when answer edits encounter a weakened workflow policy field", async () => {
    const formSubmissionId = await createApplicationFormSubmission({
      job_title: "Engineer",
      reason: "Original reason",
    });
    const { id } = await createApplication({ form_submission_id: formSubmissionId });
    await env.DB.prepare(
      `UPDATE form_fields
       SET required = 0
       WHERE form_id = (SELECT id FROM forms WHERE key = 'membership-application')
         AND key = 'agrees_bylaws'`,
    ).run();

    const response = await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ answers: { reason: "This must not persist" } }),
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MEMBERSHIP_APPLICATION_POLICY_FIELDS_INVALID" },
    });
    expect(
      await queryAll<{ data_json: string }>(
        env.DB,
        `SELECT answer.data_json
         FROM form_submission_answers answer
         WHERE answer.submission_id = ? AND answer.field_key = 'reason'`,
        formSubmissionId,
      ),
    ).toEqual([{ data_json: JSON.stringify("Original reason") }]);
  });

  it("serializes concurrent edits with the application transition revision", async () => {
    const { id } = await createApplication();
    const concurrentDb = gateBatchGroup(env.DB, 2);

    const outcomes = await Promise.allSettled([
      updateMembershipApplication(concurrentDb, id, adminActor, { applicantName: "First Correction" }),
      updateMembershipApplication(concurrentDb, id, adminActor, { applicantName: "Second Correction" }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.reason).toMatchObject({ status: 409, code: "APPLICATION_CHANGED" });
    expect(
      await queryAll<{ applicant_name: string; transition_revision: number }>(
        env.DB,
        "SELECT applicant_name, transition_revision FROM member_applications WHERE id = ?",
        id,
      ),
    ).toEqual([{ applicant_name: expect.stringMatching(/^(First|Second) Correction$/), transition_revision: 1 }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM member_application_events WHERE application_id = ?", id),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'application_edited' AND entity_id = ?", id),
    ).toHaveLength(1);
  });

  it("rejects a scheduler email built from a stale application edit", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
    const { id } = await createApplication({ stage: "on_hold" });
    await env.DB.prepare(
      `UPDATE member_applications
       SET on_hold_subtype = 'request_org_email', stage_entered_at = datetime('now', '-5 days')
       WHERE id = ?`,
    )
      .bind(id)
      .run();

    const gate = gateNextBatch(env.DB);
    const staleReminder = runOnHoldReminders(gate.db, env as any);
    await gate.reached;

    const edit = await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantEmail: "updated@example.test" }),
    });
    expect(edit.status).toBe(200);

    gate.release();
    expect(await staleReminder).toEqual({ remindersSent: 0, autoClosed: 0 });
    expect(
      await queryAll<{ applicant_email: string; transition_revision: number }>(
        env.DB,
        "SELECT applicant_email, transition_revision FROM member_applications WHERE id = ?",
        id,
      ),
    ).toEqual([{ applicant_email: "updated@example.test", transition_revision: 1 }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'application-hold-org-email'"),
    ).toHaveLength(0);
  });

  it("resolves only the requested working-group labels in the backend", async () => {
    const formSubmissionId = await createApplicationFormSubmission({
      working_groups: ["pqc", "retired-group", "pqc"],
    });
    const { id } = await createApplication({ form_submission_id: formSubmissionId });

    const response = await call(adminToken, `/api/v1/members/applications/${id}`);
    const body = (await response.json()) as {
      requestedWorkingGroups: Array<{ slug: string; name: string }>;
    };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.requestedWorkingGroups).toEqual([
      { slug: "pqc", name: "Post-Quantum Cryptography Working Group" },
      { slug: "retired-group", name: "retired-group" },
    ]);
  });

  it("uses the editable D1 voting policy for consultation concerns", async () => {
    const { id } = await createApplication({ stage: "in_consultation" });
    const userId = await insertUser("h1-member@example.test");
    const organizationId = await insertOrganization(env.DB, "H1 Member Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "H1");
    await addRepresentative(env.DB, memberId, userId);
    const memberToken = await createMemberSession(env.DB, userId, "h1-concern-member-token");

    const denied = await call(memberToken, `/api/v1/members/applications/${id}/concerns`, {
      method: "POST",
      body: JSON.stringify({ concernText: "This should initially be denied." }),
    });
    expect(denied.status).toBe(403);

    await env.DB.prepare(
      "UPDATE membership_categories SET is_voting = 1, revision = revision + 1 WHERE code = 'H1'",
    ).run();
    const accepted = await call(memberToken, `/api/v1/members/applications/${id}/concerns`, {
      method: "POST",
      body: JSON.stringify({ concernText: "This now follows the configured voting policy." }),
    });
    expect(accepted.status).toBe(201);
    expect(
      await queryAll<{ submitted_by_user_id: string; concern_text: string }>(
        env.DB,
        "SELECT submitted_by_user_id, concern_text FROM application_concerns WHERE application_id = ?",
        id,
      ),
    ).toEqual([
      {
        submitted_by_user_id: userId,
        concern_text: "This now follows the configured voting policy.",
      },
    ]);
  });

  it("rolls a concern back when voting eligibility changes before its D1 batch", async () => {
    const { id } = await createApplication({ stage: "in_consultation" });
    const userId = await insertUser("raced-concern-member@example.test");
    const organizationId = await insertOrganization(env.DB, "Raced Concern Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "H1");
    await addRepresentative(env.DB, memberId, userId);
    await env.DB.prepare("UPDATE membership_categories SET is_voting = 1 WHERE code = 'H1'").run();

    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE membership_categories SET is_voting = 0 WHERE code = 'H1'").run(),
    );
    await expect(
      submitApplicationConcern(racedDb, {
        applicationId: id,
        submittedByUserId: userId,
        submittedByMemberId: memberId,
        concernText: "This must not survive the eligibility race.",
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONCERN_ELIGIBILITY_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM application_concerns WHERE application_id = ?", id)).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'membership_application_concern_submitted' AND entity_id = ?",
        id,
      ),
    ).toHaveLength(0);
  });

  it("records a member_application_events row for the edit, distinct from a stage transition (fromStage === toStage)", async () => {
    const { id } = await createApplication({ stage: "in_review" });

    const response = await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "Renamed Applicant" }),
    });
    expect(response.status).toBe(200);

    const events = await queryAll<{ from_stage: string; to_stage: string; note: string; actor_user_id: string }>(
      env.DB,
      "SELECT from_stage, to_stage, note, actor_user_id FROM member_application_events WHERE application_id = ?",
      id,
    );
    expect(events).toHaveLength(1);
    expect(events[0].from_stage).toBe("in_review");
    expect(events[0].to_stage).toBe("in_review");
    expect(events[0].note).toContain("edited");
    expect(events[0].note).toContain("applicantName");
    expect(events[0].actor_user_id).toBe(adminId);
  });

  it("rejects API-key edits without side effects", async () => {
    const { id } = await createApplication({ stage: "in_review" });
    const response = await call(env.ADMIN_API_KEY ?? "test-admin-key", `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "API Key Correction" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
    expect(
      await queryAll<{ actor_user_id: string | null }>(
        env.DB,
        "SELECT actor_user_id FROM member_application_events WHERE application_id = ?",
        id,
      ),
    ).toEqual([]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'application_edited' AND entity_id = ?",
        id,
      ),
    ).toEqual([]);
  });

  it("allows editing an already-approved application's details more than once (uq_member_application_events_approved must not reject the from_stage=to_stage='approved' marker event)", async () => {
    const { id } = await createApplication({ stage: "approved" });

    const first = await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "First Correction" }),
    });
    expect(first.status).toBe(200);

    const second = await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "Second Correction" }),
    });
    expect(second.status).toBe(200);

    const events = await queryAll<{ from_stage: string; to_stage: string }>(
      env.DB,
      "SELECT from_stage, to_stage FROM member_application_events WHERE application_id = ? ORDER BY created_at",
      id,
    );
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.from_stage === "approved" && e.to_stage === "approved")).toBe(true);
  });

  it("writes an audit_log entry for the edit", async () => {
    const { id } = await createApplication();

    await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "Audited Name" }),
    });

    const auditRows = await queryAll<{ action: string; entity_type: string; entity_id: string; actor_id: string }>(
      env.DB,
      "SELECT action, entity_type, entity_id, actor_id FROM audit_log WHERE entity_id = ? AND action = 'application_edited'",
      id,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entity_type).toBe("member_application");
    expect(auditRows[0].actor_id).toBe(adminId);
  });

  it("clears organizationName when the category is edited to an individual (org-less) category", async () => {
    const { id } = await createApplication({ membership_category: "F", organization_name: "Old Org" });

    const response = await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ membershipCategory: "H6" }),
    });
    expect(response.status).toBe(200);

    const rows = await queryAll<{ organization_name: string | null; organization_domain: string | null }>(
      env.DB,
      "SELECT organization_name, organization_domain FROM member_applications WHERE id = ?",
      id,
    );
    expect(rows[0].organization_name).toBeNull();
    expect(rows[0].organization_domain).toBeNull();
  });

  it("rejects an empty patch body (no fields provided)", async () => {
    const { id } = await createApplication();
    const response = await call(adminToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 for a non-existent application", async () => {
    const response = await call(adminToken, `/api/v1/members/applications/${crypto.randomUUID()}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "Nobody" }),
    });
    expect(response.status).toBe(404);
  });

  it("a group lead is denied consortium-wide membership:write (403)", async () => {
    const { id } = await createApplication();
    const staffId = await insertUser("wg-chair-only@example.test");
    await assignRole(staffId, "role-group_lead", adminId, {
      type: "group",
      id: "20000000-0000-4000-8000-000000000003",
    });
    const staffToken = await createAdminSession(env.DB, staffId, "staff-wg-chair-token");

    const response = await call(staffToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "Should Not Save" }),
    });
    expect(response.status).toBe(403);

    const rows = await queryAll<{ applicant_name: string }>(
      env.DB,
      "SELECT applicant_name FROM member_applications WHERE id = ?",
      id,
    );
    expect(rows[0].applicant_name).not.toBe("Should Not Save");
  });

  it("a membership_processor role (non-admin) can edit an application", async () => {
    const { id } = await createApplication();
    const staffId = await insertUser("staff-membership@example.test");
    await assignRole(staffId, "role-membership_processor", adminId);
    const staffToken = await createAdminSession(env.DB, staffId, "staff-membership-token");

    const response = await call(staffToken, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "Processor Edited" }),
    });
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/members/applications?sort=... (Fix 4 — sortable columns)", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "membership-application-management-sort-token");

    // Distinct applicant_name/created_at ordering, inserted out of both
    // alphabetical and chronological order so sort actually changes result order.
    await createApplication({
      applicant_name: "Zed Applicant",
      applicant_email: "zed@example.test",
      organization_domain: "zed.test",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    await createApplication({
      applicant_name: "Amy Applicant",
      applicant_email: "amy@example.test",
      organization_domain: "amy.test",
      created_at: "2026-03-01T00:00:00.000Z",
    });
  });

  it("defaults to created_at DESC when no sort param is given (unchanged behavior)", async () => {
    const response = await call(adminToken, "/api/v1/members/applications");
    expect(response.status).toBe(200);
    const body = membershipApplicationsListResponseSchema.parse(await response.json());
    expect(body.applications.map((a) => a.applicantName)).toEqual(["Amy Applicant", "Zed Applicant"]);
  });

  it("sorts ascending by a valid allowlisted column (applicant_name)", async () => {
    const response = await call(adminToken, "/api/v1/members/applications?sort=applicant_name");
    expect(response.status).toBe(200);
    const body = membershipApplicationsListResponseSchema.parse(await response.json());
    expect(body.applications.map((a) => a.applicantName)).toEqual(["Amy Applicant", "Zed Applicant"]);
  });

  it("sorts descending with a leading '-'", async () => {
    const response = await call(adminToken, "/api/v1/members/applications?sort=-applicant_name");
    expect(response.status).toBe(200);
    const body = membershipApplicationsListResponseSchema.parse(await response.json());
    expect(body.applications.map((a) => a.applicantName)).toEqual(["Zed Applicant", "Amy Applicant"]);
  });

  it("applies the shared search contract in D1 and returns the matching page total", async () => {
    const response = await call(adminToken, "/api/v1/members/applications?q=amy%40example.test");
    expect(response.status).toBe(200);
    const body = membershipApplicationsListResponseSchema.parse(await response.json());
    expect(body.applications.map(({ applicantName }) => applicantName)).toEqual(["Amy Applicant"]);
    expect(body.page.total).toBe(1);
  });

  it("joins the configured category label and searches that label in D1", async () => {
    await env.DB.prepare("UPDATE membership_categories SET label = 'Consortium organizations' WHERE code = 'F'").run();

    const response = await call(
      adminToken,
      "/api/v1/members/applications?q=consortium%20organizations&limit=1&offset=0",
    );
    expect(response.status).toBe(200);
    const body = membershipApplicationsListResponseSchema.parse(await response.json());
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0]).toMatchObject({
      membershipCategory: "F",
      membershipCategoryLabel: "Consortium organizations",
    });
    expect(body.page).toMatchObject({ limit: 1, offset: 0, total: 2, hasMore: true });
  });

  it("exposes the D1-backed category catalog to readers and never the legacy admin route", async () => {
    const catalog = await call(adminToken, "/api/v1/membership/categories");
    expect(catalog.status).toBe(200);
    const catalogBody = membershipCategoryCatalogResponseSchema.parse(await catalog.json());
    expect(catalogBody.categories[0]).toMatchObject({
      code: "A",
      label: expect.any(String),
      displayOrder: 10,
      isIndividual: false,
      isVoting: true,
    });

    expect((await call(adminToken, "/api/v1/admin/applications")).status).toBe(404);
  });

  it("mounts staff collection and public form routes in the domain router and removes the System endpoint", async () => {
    expect((await call(adminToken, "/api/v1/members/applications")).status).toBe(200);
    expect((await call(adminToken, "/api/v1/system/membership-applications")).status).toBe(404);

    const publicForm = await app.fetch(
      new Request("https://app.test/api/v1/members/applications/form"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(publicForm.status).toBe(200);
  });

  it("keeps read, write, and approval capabilities independently enforceable", async () => {
    // Three identities, each holding exactly one of the three membership
    // capabilities. Independence is only demonstrable by someone whose
    // authority stops at one of them.
    const readToken = (await seedPersona(env.DB, onlyPersona("membership:read"))).token!;
    const writeToken = (await seedPersona(env.DB, onlyPersona("membership:write"))).token!;
    const approveToken = (await seedPersona(env.DB, onlyPersona("membership:approve"))).token!;

    const applicationId = crypto.randomUUID();
    expect((await call(readToken, "/api/v1/members/applications")).status).toBe(200);
    expect(
      (
        await call(readToken, `/api/v1/members/applications/${applicationId}`, {
          method: "PATCH",
          body: JSON.stringify({ applicantName: "Must not write" }),
        })
      ).status,
    ).toBe(403);

    expect((await call(writeToken, "/api/v1/members/applications")).status).toBe(403);
    expect(
      (
        await call(writeToken, `/api/v1/members/applications/${applicationId}`, {
          method: "PATCH",
          body: JSON.stringify({ applicantName: "Authorized but missing" }),
        })
      ).status,
    ).toBe(404);

    expect((await call(approveToken, "/api/v1/members/applications")).status).toBe(403);
    expect(
      (
        await call(approveToken, `/api/v1/members/applications/${applicationId}/approve`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });

  it("rejects an unknown/unsafe sort column with a 400 instead of silently ignoring it", async () => {
    const response = await call(
      adminToken,
      `/api/v1/members/applications?sort=${encodeURIComponent("id; DROP TABLE member_applications; --")}`,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const stillExists = await queryAll(env.DB, "SELECT id FROM member_applications");
    expect(stillExists.length).toBe(2);
  });
});

describe("POST /api/v1/membership/batches/:batchKey/runs", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "operations-membership-batch-token");
  });

  it("runConsultationBatch queues a consultation-batch email for applications in_consultation", async () => {
    await createApplication({ stage: "in_consultation" });

    const response = await call(adminToken, "/api/v1/membership/batches/consultation/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applicationsNotified: number };
    expect(body.applicationsNotified).toBe(1);

    const outbox = await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'consultation-batch'");
    expect(outbox).toHaveLength(1);
  });

  it("runEcReviewBatch transitions eligible applications to ec_review", async () => {
    const { id } = await createApplication({
      stage: "in_consultation",
      created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    });
    // Backdate stage_entered_at past the (default 7-day) consultation window.
    await env.DB.prepare("UPDATE member_applications SET stage_entered_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 10 * 86_400_000).toISOString(), id)
      .run();

    const response = await call(adminToken, "/api/v1/membership/batches/ec-review/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { transitioned: number };
    expect(body.transitioned).toBe(1);

    const rows = await queryAll<{ stage: string }>(env.DB, "SELECT stage FROM member_applications WHERE id = ?", id);
    expect(rows[0].stage).toBe("ec_review");
  });

  it("rejects an unknown batch kind without running another batch", async () => {
    await createApplication({ stage: "in_consultation" });

    const response = await call(adminToken, "/api/v1/membership/batches/everything/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    // One parameterised route validates the batch key against the shared
    // catalog, so an unknown key is a contract violation rather than a
    // missing route.
    expect(response.status).toBe(400);

    const outbox = await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'consultation-batch'");
    expect(outbox).toHaveLength(0);
  });
});

describe("POST /api/v1/members/applications/:id/communications", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-application-communication-token");
  });

  it("commits its email intent, communication record, and audit atomically", async () => {
    const { id } = await createApplication({ applicant_email: "communication@example.test" });
    const response = await call(adminToken, `/api/v1/members/applications/${id}/communications`, {
      method: "POST",
      body: JSON.stringify({ subject: "Additional information", body: "Please provide more detail." }),
    });
    expect(response.status).toBe(201);
    expect(
      await queryAll(env.DB, "SELECT id FROM application_communications WHERE application_id = ?", id),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", "communication@example.test"),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'application_communication_sent' AND entity_id = ?",
        id,
      ),
    ).toHaveLength(1);
  });

  it("rejects API-key communications at the user-attribution service boundary", async () => {
    const { id } = await createApplication({ applicant_email: "service-actor@example.test" });
    const response = await call(
      env.ADMIN_API_KEY ?? "test-admin-key",
      `/api/v1/members/applications/${id}/communications`,
      {
        method: "POST",
        body: JSON.stringify({ subject: "Not attributable", body: "This must not be queued." }),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
    expect(
      await queryAll(env.DB, "SELECT id FROM application_communications WHERE application_id = ?", id),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", "service-actor@example.test"),
    ).toHaveLength(0);
  });

  it("rolls back the communication and email intent when audit fails", async () => {
    const { id } = await createApplication({ applicant_email: "communication-rollback@example.test" });
    await env.DB.prepare(
      `CREATE TRIGGER fail_application_communication_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'application_communication_sent'
       BEGIN
         SELECT RAISE(ABORT, 'forced application communication audit failure');
       END`,
    ).run();

    const response = await call(adminToken, `/api/v1/members/applications/${id}/communications`, {
      method: "POST",
      body: JSON.stringify({ subject: "Must roll back", body: "This cannot become partial." }),
    });
    expect(response.status).toBe(500);
    expect(
      await queryAll(env.DB, "SELECT id FROM application_communications WHERE application_id = ?", id),
    ).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM email_outbox WHERE recipient_email = ?",
        "communication-rollback@example.test",
      ),
    ).toHaveLength(0);
    await env.DB.prepare("DROP TRIGGER fail_application_communication_audit").run();
  });
});
