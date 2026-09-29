import { expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { createApplicationFormSubmission, seedMemberApplication } from "./helpers/member-applications";
import { pinReviewedStaffWorkflow } from "./helpers/membership-workflows";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";

it("rolls back onboarding when the application is withdrawn after its completed-review snapshot", async () => {
  await resetDb();
  const id = await seedMemberApplication({
    applicantEmail: "withdrawal-race@example.test",
    applicantName: "Example User",
    organizationName: "Example Organization",
    organizationDomain: "example.test",
    membershipCategory: "F",
    formSubmissionId: await createApplicationFormSubmission({}),
    stage: "processing",
  });
  await pinReviewedStaffWorkflow(env.DB, id);
  const gate = gateNextBatch(env.DB);
  const outcome = evaluateMembershipApplication(gate.db, id, "https://app.test").then(
    () => null,
    (error: unknown) => error,
  );
  await gate.reached;
  await env.DB.prepare(
    "UPDATE member_applications SET stage = 'withdrawn', transition_revision = transition_revision + 1 WHERE id = ?",
  )
    .bind(id)
    .run();
  gate.release();
  expect(await outcome).toMatchObject({ status: 409 });
  expect(
    await env.DB.prepare("SELECT stage, member_id FROM member_applications WHERE id = ?").bind(id).first(),
  ).toEqual({ stage: "withdrawn", member_id: null });
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first("count")).toBe(0);
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE recipient_email = ?")
      .bind("withdrawal-race@example.test")
      .first("count"),
  ).toBe(0);
});
