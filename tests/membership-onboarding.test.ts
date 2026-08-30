/**
 * membership-onboarding.test.ts
 *
 * post-approval onboarding — POST /api/v1/members/applications/:id/approve.
 * Covers org-tied vs. individual branches, primary contact assignment,
 * organization_domain_claims transfer, mailing-list reconciliation, group eligibility,
 * and the three onboarding emails.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  createApplicationFormSubmission,
  requiredMembershipApplicationAnswers,
  seedMemberApplication,
  verifiedMemberApplicationPayload,
} from "./helpers/member-applications";
import { insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { approveApplication } from "../functions/_lib/services/membership/applications/approve";
import { recordEcDecision } from "../functions/_lib/services/ec-review";
import type { AuthAdmin, DatabaseLike } from "../functions/_lib/types";

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
  const existing = await env.DB.prepare("SELECT id FROM groups WHERE slug = ?").bind(slug).first<{ id: string }>();
  if (existing) return;
  const groupId = crypto.randomUUID();
  const at = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `INSERT INTO groups
         (id, type_key, name, slug, description, visibility, eligibility_mode, created_at, updated_at)
       VALUES (?, 'working_group', ?, ?, NULL, 'public', 'open', ?, ?)`,
    ).bind(groupId, slug.toUpperCase(), slug, at, at),
  ];
  if (mailingListEmail) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO mailing_lists
           (id, email, label, purpose, group_id, is_primary_discussion,
            subscription_default, posting_policy, moderation_policy, created_at, updated_at)
         VALUES (?, ?, ?, 'group', ?, 1, 'group_members', 'subscribers', 'moderated', ?, ?)`,
      ).bind(crypto.randomUUID(), mailingListEmail, `${slug.toUpperCase()} discussion`, groupId, at, at),
    );
  }
  await env.DB.batch(statements);
}

async function createEcReviewApplication(
  overrides: Record<string, unknown> = {},
  answers: Record<string, unknown> = { working_groups: ["pqc"] },
): Promise<{ id: string }> {
  const formSubmissionId = await createApplicationFormSubmission(answers);
  const id = await seedMemberApplication({
    applicantEmail: (overrides.applicant_email as string) ?? "newmember@acme.test",
    applicantName: (overrides.applicant_name as string) ?? "New Member",
    organizationName: "organization_name" in overrides ? (overrides.organization_name as string | null) : "Acme Corp",
    organizationDomain:
      "organization_domain" in overrides ? (overrides.organization_domain as string | null) : "acme.test",
    membershipCategory: (overrides.membership_category as string) ?? "F",
    formSubmissionId,
    stage: "ec_review",
  });
  return { id };
}

describe("Post-approval onboarding", () => {
  let adminToken: string;
  let adminId: string;
  let adminActor: AuthAdmin;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminId = adminRow.id;
    adminActor = { identityType: "user", id: adminId, email: "admin@pkic.org", role: "admin" };
    adminToken = await createAdminSession(env.DB, adminId, "onboarding-admin-token");
    await seedWorkingGroup("pqc", "pqc@lists.pkic.org");
    await seedWorkingGroup("ca", "ca@lists.pkic.org");
  });

  it("approves an org-tied application: creates org/user/member, sets primary contact, writes the domain", async () => {
    const { id } = await createEcReviewApplication();
    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });
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
      "SELECT domain FROM organization_domain_claims WHERE organization_id = ?",
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

    const appRows = await queryAll<{ stage: string; applicant_user_id: string | null; member_id: string | null }>(
      env.DB,
      "SELECT stage, applicant_user_id, member_id FROM member_applications WHERE id = ?",
      id,
    );
    expect(appRows[0].stage).toBe("approved");
    expect(appRows[0].applicant_user_id).toBe(body.userId);
    expect(appRows[0].member_id).toBe(body.memberId);
  });

  it("preserves explicit staff approval as an override when an EC decline already exists", async () => {
    const { id } = await createEcReviewApplication();
    const ecUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, is_ec_member, created_at, updated_at)
       VALUES (?, 'staff-override-ec@example.test', 'staff-override-ec@example.test', 'user', 1, 1,
               datetime('now'), datetime('now'))`,
    )
      .bind(ecUserId)
      .run();
    await recordEcDecision(env.DB, {
      applicationId: id,
      ecMemberUserId: ecUserId,
      decision: "decline",
      reason: "Staff will resolve this decline manually",
    });

    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { memberId: string };
    expect(
      await queryAll(env.DB, "SELECT stage, transition_revision FROM member_applications WHERE id = ?", id),
    ).toEqual([{ stage: "approved", transition_revision: 2 }]);
    expect(await queryAll(env.DB, "SELECT decision FROM ec_decisions WHERE application_id = ?", id)).toEqual([
      { decision: "decline" },
    ]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'application_approved' AND entity_id = ?", id),
    ).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM members WHERE id = ?", body.memberId)).toHaveLength(1);
  });

  it("carries job_title/linkedin from the application's answers into the provisioned representation", async () => {
    const { id } = await createEcReviewApplication(
      {},
      {
        working_groups: ["pqc"],
        job_title: "Chief Cryptography Officer",
        linkedin: "https://linkedin.com/in/newmember",
      },
    );
    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { userId: string };

    const userRows = await queryAll<{ job_title: string | null; links_json: string | null }>(
      env.DB,
      "SELECT job_title, links_json FROM users WHERE id = ?",
      body.userId,
    );
    expect(userRows).toEqual([{ job_title: null, links_json: null }]);
    const representations = await queryAll<{ job_title: string | null; links_json: string | null }>(
      env.DB,
      `SELECT job_title, links_json
         FROM organization_representatives
        WHERE user_id = ? AND left_at IS NULL`,
      body.userId,
    );
    expect(representations[0].job_title).toBe("Chief Cryptography Officer");
    expect(representations[0].links_json).toBeTruthy();
    const links = JSON.parse(representations[0].links_json as string) as string[];
    expect(links).toEqual(["https://linkedin.com/in/newmember"]);
  });

  it("creates no organization for an individual (H6) application", async () => {
    const { id } = await createEcReviewApplication(
      { organization_name: null, membership_category: "H6" },
      { working_groups: [] },
    );
    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { organizationId: string | null };
    expect(body.organizationId).toBeNull();

    const orgCount = await queryAll(env.DB, "SELECT id FROM organizations");
    expect(orgCount).toHaveLength(0);
  });

  it("adds the requested group capacity and reconciles mailing-list subscriptions", async () => {
    const { id } = await createEcReviewApplication();
    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });
    const body = (await response.json()) as { userId: string; memberId: string };

    const wgRows = await queryAll<{ member_id: string | null }>(
      env.DB,
      `SELECT membership.member_id
         FROM group_memberships membership
         JOIN groups g ON g.id = membership.group_id
        WHERE membership.user_id = ? AND g.slug = 'pqc' AND membership.left_at IS NULL`,
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

  it("omits a requested group when its configured category rule is not satisfied", async () => {
    const { id } = await createEcReviewApplication({ membership_category: "B" }, { working_groups: ["ca", "pqc"] });
    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });
    const body = (await response.json()) as { userId: string; workingGroupSlugs: string[] };
    expect(body.workingGroupSlugs).not.toContain("ca");
    expect(body.workingGroupSlugs).toContain("pqc");

    const caRows = await queryAll(
      env.DB,
      `SELECT 1
         FROM group_memberships membership
         JOIN groups g ON g.id = membership.group_id
        WHERE membership.user_id = ? AND g.slug = 'ca' AND membership.left_at IS NULL`,
      body.userId,
    );
    expect(caRows).toHaveLength(0);
  });

  it("allows category A into the CA working group", async () => {
    const { id } = await createEcReviewApplication({ membership_category: "A" }, { working_groups: ["ca"] });
    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });
    const body = (await response.json()) as { workingGroupSlugs: string[] };
    expect(body.workingGroupSlugs).toContain("ca");
  });

  it("queues member-account-claim and application-approved-welcome emails", async () => {
    const { id } = await createEcReviewApplication();
    await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });

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
    await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });

    const auditRows = await queryAll<{ actor_type: string; actor_id: string; entity_id: string; created_at: string }>(
      env.DB,
      "SELECT actor_type, actor_id, entity_id, created_at FROM audit_log WHERE action = 'application_approved' AND entity_id = ?",
      id,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actor_type).toBe("admin");
    expect(auditRows[0]!.actor_id).toBe(adminId);
    expect(
      await queryAll<{ actor_user_id: string | null }>(
        env.DB,
        "SELECT actor_user_id FROM member_application_events WHERE application_id = ? AND to_stage = 'approved'",
        id,
      ),
    ).toEqual([{ actor_user_id: adminId }]);

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

  it("rejects API-key approval without side effects", async () => {
    const { id } = await createEcReviewApplication();
    const response = await call(env.ADMIN_API_KEY ?? "test-admin-key", `/api/v1/members/applications/${id}/approve`, {
      method: "POST",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
    expect(
      await queryAll<{ actor_user_id: string | null }>(
        env.DB,
        "SELECT actor_user_id FROM member_application_events WHERE application_id = ? AND to_stage = 'approved'",
        id,
      ),
    ).toEqual([]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'application_approved' AND entity_id = ?",
        id,
      ),
    ).toEqual([]);
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
    const id = await seedMemberApplication({
      applicantEmail: "x@acme.test",
      applicantName: "X",
      organizationName: "Acme",
      organizationDomain: "acme.test",
      membershipCategory: "F",
      stage: "pending",
    });

    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(409);
  });

  it("a newly approved member's duplicate-domain check catches a later application from the same org domain", async () => {
    const { id } = await createEcReviewApplication();
    await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });

    const response = await app.fetch(
      new Request("https://app.test/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          await verifiedMemberApplicationPayload({
            applicantEmail: "another@acme.test",
            applicantName: "Another Person",
            membershipCategory: "F",
            organizationName: "Acme Corp Two",
            answers: {
              reason: "We want to contribute to the PKI community.",
              ...requiredMembershipApplicationAnswers,
            },
          }),
        ),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(409);
  });

  it("atomicity (PR #1 review §5 correction): two concurrent approvals of the same application produce exactly one success, one 409, and no duplicate provisioning/event/audit/email rows", async () => {
    const { id } = await createEcReviewApplication();

    const [first, second] = await Promise.all([
      call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" }),
      call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" }),
    ]);

    const winner = first.status === 200 ? first : second;
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const body = (await winner.json()) as { memberId: string; organizationId: string; userId: string };

    const applications = await queryAll<{ stage: string }>(
      env.DB,
      "SELECT stage FROM member_applications WHERE id = ?",
      id,
    );
    expect(applications[0]).toMatchObject({ stage: "approved" });

    const events = await queryAll(
      env.DB,
      "SELECT id FROM member_application_events WHERE application_id = ? AND to_stage = 'approved'",
      id,
    );
    expect(events).toHaveLength(1);

    const orgCount = await queryAll(env.DB, "SELECT id FROM organizations WHERE name = 'Acme Corp'");
    expect(orgCount).toHaveLength(1);

    const repRows = await queryAll(
      env.DB,
      "SELECT id FROM organization_representatives WHERE member_id = ? AND user_id = ? AND left_at IS NULL",
      body.memberId,
      body.userId,
    );
    expect(repRows).toHaveLength(1);

    const auditRows = await queryAll(
      env.DB,
      "SELECT id FROM audit_log WHERE action = 'application_approved' AND entity_id = ?",
      id,
    );
    expect(auditRows).toHaveLength(1);

    const claimEmails = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'member-account-claim'",
    );
    expect(claimEmails).toHaveLength(1);

    const syncRows = await queryAll<{ google_group_email: string }>(
      env.DB,
      "SELECT google_group_email FROM google_groups_sync_queue WHERE user_id = ?",
      body.userId,
    );
    // The canonical subscription projection emits at most one desired-state
    // transition per list; the losing approval race contributes no rows.
    const groupEmails = new Set(syncRows.map((r) => r.google_group_email));
    expect(groupEmails).toEqual(new Set(["pkic@lists.pkic.org", "consultation@lists.pkic.org", "pqc@lists.pkic.org"]));
  });

  it("rolls back every approval side effect when a concurrent transition to a different stage wins", async () => {
    const { id } = await createEcReviewApplication();
    const baseDb: DatabaseLike = env.DB;
    let injectedWinningTransition = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!injectedWinningTransition) {
          injectedWinningTransition = true;
          await baseDb.batch([
            baseDb
              .prepare(
                `UPDATE member_applications
                 SET stage = 'declined', stage_entered_at = datetime('now'), updated_at = datetime('now')
                 WHERE id = ? AND stage = 'ec_review'`,
              )
              .bind(id),
            baseDb
              .prepare(
                `INSERT INTO member_application_events
                   (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
                 VALUES (?, ?, 'ec_review', 'declined', NULL, 'Concurrent decline', datetime('now'))`,
              )
              .bind(crypto.randomUUID(), id),
            baseDb.prepare("DELETE FROM organization_domain_claims WHERE application_id = ?").bind(id),
          ]);
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      approveApplication(racingDb, {
        applicationId: id,
        actor: adminActor,
        approvalMode: "staff_override",
        loginUrl: "https://pkic.org/members/login/",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(await queryAll<{ stage: string }>(env.DB, "SELECT stage FROM member_applications WHERE id = ?", id)).toEqual(
      [{ stage: "declined" }],
    );
    expect(await queryAll(env.DB, "SELECT id FROM organizations WHERE normalized_name = 'acme corp'")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = 'newmember@acme.test'")).toHaveLength(
      0,
    );
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM member_application_events WHERE application_id = ? AND to_stage = 'approved'",
        id,
      ),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'application_approved' AND entity_id = ?", id),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = 'newmember@acme.test'"),
    ).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM google_groups_sync_queue")).toHaveLength(0);
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

    const response = await call(adminToken, `/api/v1/members/applications/${id}/approve`, { method: "POST" });
    expect(response.status).toBe(409);

    const applications = await queryAll<{ stage: string }>(
      env.DB,
      "SELECT stage FROM member_applications WHERE id = ?",
      id,
    );
    expect(applications[0]).toMatchObject({ stage: "ec_review" });

    const events = await queryAll(env.DB, "SELECT id FROM member_application_events WHERE application_id = ?", id);
    expect(events).toHaveLength(0);

    const syncRows = await queryAll(env.DB, "SELECT id FROM google_groups_sync_queue");
    expect(syncRows).toHaveLength(0);

    const users = await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", "newmember@acme.test");
    expect(users).toHaveLength(0);
  });
});
