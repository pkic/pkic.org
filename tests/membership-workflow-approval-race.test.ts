import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { seedMemberApplication, createApplicationFormSubmission } from "./helpers/member-applications";
import { pinReviewedStaffWorkflow } from "./helpers/membership-workflows";
import { queryAll } from "./helpers/context";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";
import { runMembershipWorkflows } from "../functions/_lib/services/membership/workflows/scheduled";

beforeEach(resetDb);

it("rolls back provisioning when an objection appears after the approval snapshot", async () => {
  const id = await seedMemberApplication({
    applicantEmail: "review-race@example.test",
    applicantName: "Example User",
    organizationName: "Example Organization",
    organizationDomain: "example.test",
    membershipCategory: "F",
    formSubmissionId: await createApplicationFormSubmission({}),
    stage: "processing",
  });
  await pinReviewedStaffWorkflow(env.DB, id);
  const gate = gateNextBatch(env.DB);
  const pending = evaluateMembershipApplication(gate.db, id, "https://app.test");
  const outcome = pending.then(
    () => null,
    (error: unknown) => error,
  );
  await gate.reached;
  // Even an objection inserted without a revision bump must defeat the final live guard.
  await env.DB.prepare(
    `INSERT INTO membership_application_objections
    (id, application_id, generation, step_position, body, state, created_at)
    VALUES (?, ?, 1, 0, 'Ownership evidence needs review', 'unresolved', ?)`,
  )
    .bind(crypto.randomUUID(), id, new Date().toISOString())
    .run();
  gate.release();
  expect(await outcome).toMatchObject({ status: 409 });
  expect(await queryAll(env.DB, "SELECT stage, member_id FROM member_applications WHERE id = ?", id)).toEqual([
    { stage: "processing", member_id: null },
  ]);
  expect(
    await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = 'review-race@example.test'"),
  ).toHaveLength(0);
});

it("does not provision an application missing its required workflow", async () => {
  const id = await seedMemberApplication({
    applicantEmail: "historic@example.test",
    applicantName: "Example User",
    organizationName: null,
    organizationDomain: null,
    membershipCategory: "H6",
    formSubmissionId: null,
    stage: "submitted",
    stageEnteredAt: "2025-01-01T00:00:00.000Z",
  });
  expect(await runMembershipWorkflows(env.DB, "https://app.test")).toMatchObject({ summary: { evaluated: 0 } });
  expect(await queryAll(env.DB, "SELECT stage, member_id FROM member_applications WHERE id = ?", id)).toEqual([
    { stage: "submitted", member_id: null },
  ]);
});
