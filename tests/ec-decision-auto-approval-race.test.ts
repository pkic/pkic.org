import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { seedMemberApplication } from "./helpers/member-applications";
import { updateMembershipSettings } from "../functions/_lib/services/membership-settings";
import { runEcWindowAutoApprove } from "../functions/_lib/services/membership/scheduled-jobs";
import { recordEcDecision } from "../functions/_lib/services/ec-review";

async function createOverdueApplication(applicantEmail: string): Promise<string> {
  return seedMemberApplication({
    applicantEmail,
    applicantName: "Race Applicant",
    organizationName: null,
    organizationDomain: null,
    membershipCategory: "H6",
    formSubmissionId: null,
    stage: "ec_review",
    stageEnteredAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
  });
}

async function createEcMember(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, is_ec_member, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

async function expectNoAutoApprovalFallout(applicationId: string, applicantEmail: string): Promise<void> {
  expect(await queryAll(env.DB, "SELECT stage FROM member_applications WHERE id = ?", applicationId)).toEqual([
    { stage: "ec_review" },
  ]);
  expect(
    await queryAll(
      env.DB,
      `SELECT member.id
       FROM members member
       JOIN users user ON user.id = member.user_id
       WHERE user.normalized_email = ?`,
      applicantEmail,
    ),
  ).toEqual([]);
  expect(
    await queryAll(
      env.DB,
      `SELECT queue.id
       FROM google_groups_sync_queue queue
       JOIN users user ON user.id = queue.user_id
       WHERE user.normalized_email = ?`,
      applicantEmail,
    ),
  ).toEqual([]);
  expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", applicantEmail)).toEqual([]);
}

describe("EC decision and automatic approval serialization", () => {
  beforeEach(async () => {
    await resetDb();
    await updateMembershipSettings(env.DB, { ecReviewWindowDays: 7 }, null);
  });

  it("rolls back auto-approval when an EC decline commits after the scheduler snapshot", async () => {
    const applicantEmail = "snapshot-race@example.test";
    const applicationId = await createOverdueApplication(applicantEmail);
    const ecUserId = await createEcMember("snapshot-decliner@example.test");
    const gate = gateNextBatch(env.DB);

    const scheduled = runEcWindowAutoApprove(gate.db, env as any);
    await gate.reached;
    await recordEcDecision(env.DB, {
      applicationId,
      ecMemberUserId: ecUserId,
      decision: "decline",
      reason: "Concern recorded after scheduler selection",
    });
    gate.release();

    expect(await scheduled).toEqual({ autoApproved: 0, heldForDecline: 1, deferredForBudget: false });
    expect(
      await queryAll(env.DB, "SELECT stage, transition_revision FROM member_applications WHERE id = ?", applicationId),
    ).toEqual([{ stage: "ec_review", transition_revision: 1 }]);
    expect(await queryAll(env.DB, "SELECT decision FROM ec_decisions WHERE application_id = ?", applicationId)).toEqual(
      [{ decision: "decline" }],
    );
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'ec_decision_recorded' AND entity_id = ?",
        applicationId,
      ),
    ).toHaveLength(1);
    await expectNoAutoApprovalFallout(applicationId, applicantEmail);
  });

  it("rejects and fully rolls back an EC decline that loses to auto-approval", async () => {
    const applicantEmail = "late-decision@example.test";
    const applicationId = await createOverdueApplication(applicantEmail);
    const ecUserId = await createEcMember("late-decliner@example.test");
    const gate = gateNextBatch(env.DB);

    const decision = recordEcDecision(gate.db, {
      applicationId,
      ecMemberUserId: ecUserId,
      decision: "decline",
      reason: "Decision began while EC review was open",
    });
    await gate.reached;
    expect(await runEcWindowAutoApprove(env.DB, env as any)).toMatchObject({ autoApproved: 1 });
    gate.release();

    await expect(decision).rejects.toMatchObject({ status: 409, code: "APPLICATION_NOT_IN_EC_REVIEW" });
    expect(
      await queryAll(env.DB, "SELECT stage, transition_revision FROM member_applications WHERE id = ?", applicationId),
    ).toEqual([{ stage: "approved", transition_revision: 1 }]);
    expect(await queryAll(env.DB, "SELECT id FROM ec_decisions WHERE application_id = ?", applicationId)).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'ec_decision_recorded' AND entity_id = ?",
        applicationId,
      ),
    ).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        `SELECT member.id
         FROM members member
         JOIN users user ON user.id = member.user_id
         WHERE user.normalized_email = ?`,
        applicantEmail,
      ),
    ).toHaveLength(1);
    expect(
      (await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", applicantEmail)).length,
    ).toBeGreaterThan(0);
  });

  it("rolls back auto-approval when an existing EC approval is revised to decline after selection", async () => {
    const applicantEmail = "revised-decision-race@example.test";
    const applicationId = await createOverdueApplication(applicantEmail);
    const ecUserId = await createEcMember("decision-reviser@example.test");
    await recordEcDecision(env.DB, {
      applicationId,
      ecMemberUserId: ecUserId,
      decision: "approve",
    });
    const gate = gateNextBatch(env.DB);

    const scheduled = runEcWindowAutoApprove(gate.db, env as any);
    await gate.reached;
    await recordEcDecision(env.DB, {
      applicationId,
      ecMemberUserId: ecUserId,
      decision: "decline",
      reason: "Changed decision after scheduler selection",
    });
    gate.release();

    expect(await scheduled).toEqual({ autoApproved: 0, heldForDecline: 1, deferredForBudget: false });
    expect(
      await queryAll(env.DB, "SELECT stage, transition_revision FROM member_applications WHERE id = ?", applicationId),
    ).toEqual([{ stage: "ec_review", transition_revision: 2 }]);
    expect(await queryAll(env.DB, "SELECT decision FROM ec_decisions WHERE application_id = ?", applicationId)).toEqual(
      [{ decision: "decline" }],
    );
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'ec_decision_recorded' AND entity_id = ?",
        applicationId,
      ),
    ).toHaveLength(2);
    await expectNoAutoApprovalFallout(applicationId, applicantEmail);
  });
});
