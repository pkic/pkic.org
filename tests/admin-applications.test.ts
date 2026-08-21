/**
 * admin-applications.test.ts
 *
 * admin membership application endpoints:
 *  - PATCH /api/v1/admin/applications/:id (Fix 3: correct applicant-submitted
 *    fields without transitioning stage)
 *  - GET /api/v1/admin/applications?sort=... (Fix 4: sortable columns)
 *  - POST /api/v1/internal/jobs/run with runConsultationBatch/runEcReviewBatch
 *    (Fix 5b: manual off-cycle triggers for the twice-weekly membership
 *    batches)
 *
 * Structure mirrors tests/admin-members.test.ts and
 * tests/application-stage-machine.test.ts.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createApplicationFormSubmission, seedMemberApplication } from "./helpers/member-applications";

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

async function assignRole(userId: string, roleId: string, grantedBy: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, grantedBy)
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

describe("PATCH /api/v1/admin/applications/:id (Fix 3 — edit application fields)", () => {
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminId = adminRow.id;
    adminToken = await createAdminSession(env.DB, adminId, "admin-applications-token");
  });

  it("edits top-level fields and answers, without transitioning stage", async () => {
    const formSubmissionId = await createApplicationFormSubmission({
      job_title: "Engineer",
      reason: "Original reason",
    });
    const { id } = await createApplication({ form_submission_id: formSubmissionId });

    const response = await call(adminToken, `/api/v1/admin/applications/${id}`, {
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

  it("resolves only the requested working-group labels in the backend", async () => {
    await env.DB.prepare(
      `INSERT INTO working_groups
         (id, name, slug, description, mailing_list_email, min_endorsers_for_ballot, active, created_at, updated_at)
       VALUES (?, 'Post-Quantum Cryptography Working Group', 'pqc', NULL, NULL, 0, 1, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID())
      .run();
    const formSubmissionId = await createApplicationFormSubmission({
      working_groups: ["pqc", "retired-group", "pqc"],
    });
    const { id } = await createApplication({ form_submission_id: formSubmissionId });

    const response = await call(adminToken, `/api/v1/admin/applications/${id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      requestedWorkingGroups: Array<{ slug: string; name: string }>;
    };
    expect(body.requestedWorkingGroups).toEqual([
      { slug: "pqc", name: "Post-Quantum Cryptography Working Group" },
      { slug: "retired-group", name: "retired-group" },
    ]);
  });

  it("records a member_application_events row for the edit, distinct from a stage transition (fromStage === toStage)", async () => {
    const { id } = await createApplication({ stage: "in_review" });

    const response = await call(adminToken, `/api/v1/admin/applications/${id}`, {
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

  it("allows editing an already-approved application's details more than once (uq_member_application_events_approved must not reject the from_stage=to_stage='approved' marker event)", async () => {
    const { id } = await createApplication({ stage: "approved" });

    const first = await call(adminToken, `/api/v1/admin/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "First Correction" }),
    });
    expect(first.status).toBe(200);

    const second = await call(adminToken, `/api/v1/admin/applications/${id}`, {
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

    await call(adminToken, `/api/v1/admin/applications/${id}`, {
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

    const response = await call(adminToken, `/api/v1/admin/applications/${id}`, {
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
    const response = await call(adminToken, `/api/v1/admin/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 for a non-existent application", async () => {
    const response = await call(adminToken, `/api/v1/admin/applications/${crypto.randomUUID()}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "Nobody" }),
    });
    expect(response.status).toBe(404);
  });

  it("a staff user holding an unrelated role (wg_chair) is denied membership:write (403)", async () => {
    const { id } = await createApplication();
    const staffId = await insertUser("wg-chair-only@example.test");
    await assignRole(staffId, "role-wg_chair", adminId);
    const staffToken = await createAdminSession(env.DB, staffId, "staff-wg-chair-token");

    const response = await call(staffToken, `/api/v1/admin/applications/${id}`, {
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

    const response = await call(staffToken, `/api/v1/admin/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ applicantName: "Processor Edited" }),
    });
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/admin/applications?sort=... (Fix 4 — sortable columns)", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-applications-sort-token");

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
    const response = await call(adminToken, "/api/v1/admin/applications");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applications: Array<{ applicantName: string }> };
    expect(body.applications.map((a) => a.applicantName)).toEqual(["Amy Applicant", "Zed Applicant"]);
  });

  it("sorts ascending by a valid allowlisted column (applicant_name)", async () => {
    const response = await call(adminToken, "/api/v1/admin/applications?sort=applicant_name");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applications: Array<{ applicantName: string }> };
    expect(body.applications.map((a) => a.applicantName)).toEqual(["Amy Applicant", "Zed Applicant"]);
  });

  it("sorts descending with a leading '-'", async () => {
    const response = await call(adminToken, "/api/v1/admin/applications?sort=-applicant_name");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applications: Array<{ applicantName: string }> };
    expect(body.applications.map((a) => a.applicantName)).toEqual(["Zed Applicant", "Amy Applicant"]);
  });

  it("applies the shared search contract in D1 and returns the matching page total", async () => {
    const response = await call(adminToken, "/api/v1/admin/applications?q=amy%40example.test");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      applications: Array<{ applicantName: string }>;
      page: { total: number };
    };
    expect(body.applications.map(({ applicantName }) => applicantName)).toEqual(["Amy Applicant"]);
    expect(body.page.total).toBe(1);
  });

  it("rejects an unknown/unsafe sort column with a 400 instead of silently ignoring it", async () => {
    const response = await call(
      adminToken,
      `/api/v1/admin/applications?sort=${encodeURIComponent("id; DROP TABLE member_applications; --")}`,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const stillExists = await queryAll(env.DB, "SELECT id FROM member_applications");
    expect(stillExists.length).toBe(2);
  });
});

describe("POST /api/v1/internal/jobs/run — runConsultationBatch/runEcReviewBatch (Fix 5b)", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-jobs-token");
  });

  it("runConsultationBatch queues a consultation-batch email for applications in_consultation", async () => {
    await createApplication({ stage: "in_consultation" });

    const response = await call(adminToken, "/api/v1/internal/jobs/run", {
      method: "POST",
      body: JSON.stringify({
        runReminders: false,
        runRetention: false,
        runOutbox: false,
        runConsultationBatch: true,
        dryRun: false,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { consultationBatch: { applicationsNotified: number } };
    expect(body.consultationBatch.applicationsNotified).toBe(1);

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

    const response = await call(adminToken, "/api/v1/internal/jobs/run", {
      method: "POST",
      body: JSON.stringify({
        runReminders: false,
        runRetention: false,
        runOutbox: false,
        runEcReviewBatch: true,
        dryRun: false,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ecReviewBatch: { transitioned: number } };
    expect(body.ecReviewBatch.transitioned).toBe(1);

    const rows = await queryAll<{ stage: string }>(env.DB, "SELECT stage FROM member_applications WHERE id = ?", id);
    expect(rows[0].stage).toBe("ec_review");
  });

  it("does not run the membership batches when their flags are omitted (defaults false)", async () => {
    await createApplication({ stage: "in_consultation" });

    const response = await call(adminToken, "/api/v1/internal/jobs/run", {
      method: "POST",
      body: JSON.stringify({ runReminders: false, runRetention: false, runOutbox: false, dryRun: false }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      consultationBatch: { applicationsNotified: number };
      ecReviewBatch: { transitioned: number };
    };
    expect(body.consultationBatch.applicationsNotified).toBe(0);
    expect(body.ecReviewBatch.transitioned).toBe(0);

    const outbox = await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'consultation-batch'");
    expect(outbox).toHaveLength(0);
  });
});

describe("POST /api/v1/admin/applications/:id/communications", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-application-communication-token");
  });

  it("commits its email intent, communication record, and audit atomically", async () => {
    const { id } = await createApplication({ applicant_email: "communication@example.test" });
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/communications`, {
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

    const response = await call(adminToken, `/api/v1/admin/applications/${id}/communications`, {
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
