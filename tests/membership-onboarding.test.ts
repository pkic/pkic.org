/**
 * membership-onboarding.test.ts
 *
 * post-approval onboarding — POST /api/v1/admin/applications/:id/approve.
 * Covers org-tied vs. individual branches, primary contact assignment,
 * organization_domains_json write, Google Groups enqueue, CA WG constraint,
 * and the three onboarding emails.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createApplicationFormSubmission } from "./helpers/member-applications";

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

    const orgRows = await queryAll<{
      name: string;
      primary_contact_user_id: string;
      organization_domains_json: string;
    }>(
      env.DB,
      "SELECT name, primary_contact_user_id, organization_domains_json FROM organizations WHERE id = ?",
      body.organizationId,
    );
    expect(orgRows[0].name).toBe("Acme Corp");
    expect(orgRows[0].primary_contact_user_id).toBe(body.userId);
    expect(JSON.parse(orgRows[0].organization_domains_json)).toEqual(["acme.test"]);

    const memberRows = await queryAll<{ member_type: string; status: string; organization_id: string }>(
      env.DB,
      "SELECT member_type, status, organization_id FROM members WHERE id = ?",
      body.memberId,
    );
    expect(memberRows[0].member_type).toBe("F");
    expect(memberRows[0].status).toBe("active");
    expect(memberRows[0].organization_id).toBe(body.organizationId);

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
    const body = (await response.json()) as { userId: string };

    const wgRows = await queryAll(
      env.DB,
      "SELECT 1 FROM working_group_members wgm JOIN working_groups wg ON wg.id = wgm.working_group_id WHERE wgm.user_id = ? AND wg.slug = 'pqc'",
      body.userId,
    );
    expect(wgRows).toHaveLength(1);

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
    const { id } = await createEcReviewApplication(
      { membership_category: "B" },
      { working_groups: ["ca", "pqc"] },
    );
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
    const { id } = await createEcReviewApplication(
      { membership_category: "A" },
      { working_groups: ["ca"] },
    );
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
});
