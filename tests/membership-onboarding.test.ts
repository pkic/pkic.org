/**
 * membership-onboarding.test.ts
 *
 * post-approval onboarding — POST /api/v1/admin/applications/:id/approve.
 * Covers org-tied vs. individual branches, primary contact assignment,
 * organization_domains write, Google Groups enqueue, CA WG constraint,
 * and the three onboarding emails.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createApplicationFormSubmission } from "./helpers/member-applications";
import { insertOrganization, seedOrganizationAggregate } from "./helpers/membership";

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

async function seedWorkingGroup(slug: string, mailingListEmail: string | null = null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO working_groups (id, name, slug, description, mailing_list_email, active, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, 1, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), slug.toUpperCase(), slug, mailingListEmail)
    .run();
}

async function createEcReviewApplication(
  overrides: Record<string, unknown> = {},
  answers: Record<string, unknown> = { working_groups: ["pqc"] },
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const formSubmissionId = await createApplicationFormSubmission(answers);
  await env.DB.prepare(
    `INSERT INTO member_applications
       (id, applicant_email, applicant_name, organization_name, organization_domain, membership_category,
        form_submission_id, status, stage, stage_entered_at, manage_token_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ec_review', 'ec_review', datetime('now'), ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      (overrides.applicant_email as string) ?? "newmember@acme.test",
      (overrides.applicant_name as string) ?? "New Member",
      (overrides.organization_name as string) ?? "Acme Corp",
      (overrides.organization_domain as string) ?? "acme.test",
      (overrides.membership_category as string) ?? "F",
      formSubmissionId,
      crypto.randomUUID(),
    )
    .run();
  return { id };
}

describe("Post-approval onboarding", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "onboarding-admin-token");
    await seedWorkingGroup("pqc", "pqc@lists.pkic.org");
    await seedWorkingGroup("ca", "ca@lists.pkic.org");
  });

  it("approves an org-tied application: creates org/user/member, sets primary contact, writes the domain", async () => {
    const { id } = await createEcReviewApplication();
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { organizationId: string; memberId: string; userId: string };
    expect(body.organizationId).toBeTruthy();

    const orgRows = await queryAll<{ name: string }>(
      env.DB,
      "SELECT name FROM organizations WHERE id = ?",
      body.organizationId,
    );
    expect(orgRows[0].name).toBe("Acme Corp");

    const primaryContactRows = await queryAll<{ user_id: string }>(
      env.DB,
      `SELECT user_id FROM user_roles WHERE context_type = 'organization' AND context_id = ? AND role_id = 'role-primary_contact' AND revoked_at IS NULL`,
      body.memberId,
    );
    expect(primaryContactRows[0].user_id).toBe(body.userId);

    const repRows = await queryAll<{ user_id: string; left_at: string | null }>(
      env.DB,
      "SELECT user_id, left_at FROM organization_representatives WHERE member_id = ? AND user_id = ?",
      body.memberId,
      body.userId,
    );
    expect(repRows[0].left_at).toBeNull();

    const domainRows = await queryAll<{ domain: string }>(
      env.DB,
      "SELECT domain FROM organization_domains WHERE organization_id = ?",
      body.organizationId,
    );
    expect(domainRows.map((r) => r.domain)).toEqual(["acme.test"]);

    const memberRows = await queryAll<{ member_type: string; status: string; organization_id: string }>(
      env.DB,
      "SELECT member_type, status, organization_id FROM members WHERE id = ?",
      body.memberId,
    );
    expect(memberRows[0].member_type).toBe("organization");
    expect(memberRows[0].status).toBe("active");
    expect(memberRows[0].organization_id).toBe(body.organizationId);

    const categoryRows = await queryAll<{ category_code: string }>(
      env.DB,
      "SELECT category_code FROM member_category_assignments WHERE member_id = ?",
      body.memberId,
    );
    expect(categoryRows[0].category_code).toBe("F");

    const appRows = await queryAll<{ status: string; stage: string }>(
      env.DB,
      "SELECT status, stage FROM member_applications WHERE id = ?",
      id,
    );
    expect(appRows[0].status).toBe("approved");
    expect(appRows[0].stage).toBe("approved");
  });

  it("carries job_title/linkedin from the application's answers into the provisioned user (Fix 5b)", async () => {
    const { id } = await createEcReviewApplication(
      {},
      {
        working_groups: ["pqc"],
        job_title: "Chief Cryptography Officer",
        linkedin: "https://linkedin.com/in/newmember",
      },
    );
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { userId: string };

    const userRows = await queryAll<{ job_title: string | null; links_json: string | null }>(
      env.DB,
      "SELECT job_title, links_json FROM users WHERE id = ?",
      body.userId,
    );
    expect(userRows[0].job_title).toBe("Chief Cryptography Officer");
    expect(userRows[0].links_json).toBeTruthy();
    const links = JSON.parse(userRows[0].links_json as string) as string[];
    expect(links).toEqual(["https://linkedin.com/in/newmember"]);
  });

  it("creates no organization for an individual (H6) application", async () => {
    const { id } = await createEcReviewApplication(
      { organization_name: null, membership_category: "H6" },
      { working_groups: [] },
    );
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { organizationId: string | null };
    expect(body.organizationId).toBeNull();

    const orgCount = await queryAll(env.DB, "SELECT id FROM organizations");
    expect(orgCount).toHaveLength(0);
  });

  it("adds the member to working_group_members for requested WGs and enqueues Google Groups sync", async () => {
    const { id } = await createEcReviewApplication();
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });
    const body = (await response.json()) as { userId: string; memberId: string };

    const wgRows = await queryAll<{ member_id: string | null }>(
      env.DB,
      "SELECT wgm.member_id FROM working_group_members wgm JOIN working_groups wg ON wg.id = wgm.working_group_id WHERE wgm.user_id = ? AND wg.slug = 'pqc'",
      body.userId,
    );
    expect(wgRows).toHaveLength(1);
    // PR #1 review blocker 2: provisioning always knows exactly which
    // membership the WG join is on behalf of — not ambiguous the way a
    // staff-driven add for an existing user with multiple orgs can be.
    expect(wgRows[0]!.member_id).toBe(body.memberId);

    const queueRows = await queryAll<{ google_group_email: string; action: string }>(
      env.DB,
      "SELECT google_group_email, action FROM google_groups_sync_queue WHERE user_id = ? ORDER BY google_group_email",
      body.userId,
    );
    const groupEmails = queueRows.map((r) => r.google_group_email);
    expect(groupEmails).toContain("pkic@lists.pkic.org");
    expect(groupEmails).toContain("consultation@lists.pkic.org");
    expect(groupEmails).toContain("pqc@lists.pkic.org");
  });

  it("enforces the CA working group constraint even if requested by a non-A category", async () => {
    const { id } = await createEcReviewApplication({ membership_category: "B" }, { working_groups: ["ca", "pqc"] });
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });
    const body = (await response.json()) as { userId: string; workingGroupSlugs: string[] };
    expect(body.workingGroupSlugs).not.toContain("ca");
    expect(body.workingGroupSlugs).toContain("pqc");

    const caRows = await queryAll(
      env.DB,
      "SELECT 1 FROM working_group_members wgm JOIN working_groups wg ON wg.id = wgm.working_group_id WHERE wgm.user_id = ? AND wg.slug = 'ca'",
      body.userId,
    );
    expect(caRows).toHaveLength(0);
  });

  it("allows category A into the CA working group", async () => {
    const { id } = await createEcReviewApplication({ membership_category: "A" }, { working_groups: ["ca"] });
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });
    const body = (await response.json()) as { workingGroupSlugs: string[] };
    expect(body.workingGroupSlugs).toContain("ca");
  });

  it("queues member-account-claim and application-approved-welcome emails", async () => {
    const { id } = await createEcReviewApplication();
    await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });

    const claimEmails = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'member-account-claim'",
    );
    const welcomeEmails = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'application-approved-welcome'",
    );
    const contactEmails = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'org-contact-assigned'",
    );
    expect(claimEmails).toHaveLength(1);
    expect(welcomeEmails).toHaveLength(1);
    expect(contactEmails).toHaveLength(1);
  });

  it("writes the audit-log entry and queues the emails in the same commit as membership provisioning (PR #1 review blocker 4)", async () => {
    const { id } = await createEcReviewApplication();
    await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });

    const auditRows = await queryAll<{ actor_type: string; actor_id: string; entity_id: string; created_at: string }>(
      env.DB,
      "SELECT actor_type, actor_id, entity_id, created_at FROM audit_log WHERE action = 'application_approved' AND entity_id = ?",
      id,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actor_type).toBe("admin");

    // Same `now` timestamp is used to build the stage-transition, the
    // email-outbox inserts, and the audit-log insert inside approve.ts's
    // one `db.batch()` — proof they're one statement set, not three-plus
    // separately timed writes.
    const [{ stage_entered_at: applicationApprovedAt }] = await queryAll<{ stage_entered_at: string }>(
      env.DB,
      "SELECT stage_entered_at FROM member_applications WHERE id = ?",
      id,
    );
    const [claimEmail] = await queryAll<{ created_at: string }>(
      env.DB,
      "SELECT created_at FROM email_outbox WHERE template_key = 'member-account-claim'",
    );
    expect(claimEmail!.created_at).toBe(applicationApprovedAt);
    expect(auditRows[0]!.created_at).toBe(applicationApprovedAt);
  });

  it("does not write an audit-log entry for the unattended EC-window auto-approve path (no admin actor)", async () => {
    const { id } = await createEcReviewApplication();
    await env.DB.prepare(`UPDATE member_applications SET stage_entered_at = datetime('now', '-30 days') WHERE id = ?`)
      .bind(id)
      .run();

    const { runEcWindowAutoApprove } = await import("../functions/_lib/services/membership/scheduled-jobs");
    const result = await runEcWindowAutoApprove(env.DB, env as any);
    expect(result.autoApproved).toBe(1);

    const auditRows = await queryAll(
      env.DB,
      "SELECT id FROM audit_log WHERE action = 'application_approved' AND entity_id = ?",
      id,
    );
    expect(auditRows).toHaveLength(0);

    const claimEmails = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'member-account-claim'",
    );
    expect(claimEmails).toHaveLength(1);
  });

  it("rejects approval when the application is not in ec_review", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO member_applications
         (id, applicant_email, applicant_name, organization_name, organization_domain, membership_category,
          status, stage, stage_entered_at, manage_token_hash, created_at, updated_at)
       VALUES (?, 'x@acme.test', 'X', 'Acme', 'acme.test', 'F', 'pending', 'pending', datetime('now'), ?, datetime('now'), datetime('now'))`,
    )
      .bind(id, crypto.randomUUID())
      .run();

    const response = await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(409);
  });

  it("a newly approved member's duplicate-domain check catches a later application from the same org domain", async () => {
    const { id } = await createEcReviewApplication();
    await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });

    const response = await app.fetch(
      new Request("https://app.test/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicantEmail: "another@acme.test",
          applicantName: "Another Person",
          membershipCategory: "F",
          organizationName: "Acme Corp Two",
        }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(409);
  });

  it("atomicity (PR #1 review blocker 4): a provisioning failure leaves the application in ec_review, with no partial event/queue rows", async () => {
    // Seed an organization whose aggregate already has a *different*
    // category than the application requests — forces
    // buildProvisionOrganizationMembership to throw MEMBER_CATEGORY_CONFLICT
    // before any statement is built. Before this fix, provisioning,
    // the stage transition, and the Google Groups enqueues were three
    // separate db.batch() calls; a failure here previously could only
    // ever occur *after* provisioning already committed (since the old
    // conflict check ran inside provisioning's own post-batch re-read),
    // which would have left a member/organization created for an
    // application still sitting in ec_review. Now the conflict is
    // detected before anything is built at all, so this assertion holds
    // for both designs — the real regression coverage is the "nothing
    // partial" checks below, not just the 409 itself.
    const orgId = await insertOrganization(env.DB, "Conflicting Category Org");
    await seedOrganizationAggregate(env.DB, orgId, "F");
    const { id } = await createEcReviewApplication({
      organization_name: "Conflicting Category Org",
      organization_domain: "conflicting.test",
      membership_category: "G",
    });

    const response = await call(adminToken, `/api/v1/admin/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(409);

    const applications = await queryAll<{ status: string; stage: string }>(
      env.DB,
      "SELECT status, stage FROM member_applications WHERE id = ?",
      id,
    );
    expect(applications[0]).toMatchObject({ status: "ec_review", stage: "ec_review" });

    const events = await queryAll(env.DB, "SELECT id FROM member_application_events WHERE application_id = ?", id);
    expect(events).toHaveLength(0);

    const syncRows = await queryAll(env.DB, "SELECT id FROM google_groups_sync_queue");
    expect(syncRows).toHaveLength(0);

    const users = await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", "newmember@acme.test");
    expect(users).toHaveLength(0);
  });
});
