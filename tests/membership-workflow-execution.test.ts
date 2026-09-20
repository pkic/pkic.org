import { insertUser } from "./helpers/membership";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { recordMembershipObjection } from "../functions/_lib/services/membership/workflows/objections";
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createApplicationFormSubmission, seedMemberApplication } from "./helpers/member-applications";
import { seatInExecutiveCouncil, unseatFromExecutiveCouncil } from "./helpers/group-leadership";
import { getMembershipExecution } from "../functions/_lib/services/membership/workflows/execution";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";
import { prepareMembershipWorkflowPin } from "../functions/_lib/services/membership/workflows/pinning";
import { requireMembershipCategory } from "../functions/_lib/services/membership/categories";
import { getMembershipWorkflowVersion } from "../functions/_lib/services/membership/workflows/catalog";
import { membershipWorkflowDefinitionSchema } from "../assets/shared/schemas/membership-workflows";

beforeEach(resetDb);

it("requires an authorized staff review, a sent notice and a full window, then resolves the last objection and provisions atomically", async () => {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  await seatInExecutiveCouncil(env.DB, admin.id);
  const token = await createAdminSession(env.DB, admin.id, "workflow-reviewer");
  const workflowId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const definition = membershipWorkflowDefinitionSchema.parse({
    name: "Example Organization review",
    policyReference: "Synthetic review policy",
    steps: [
      {
        id: crypto.randomUUID(),
        kind: "staff_review",
        label: "Review organization details",
        instructions: "Check the application form.",
        reviewerGroupId: null,
      },
      {
        id: crypto.randomUUID(),
        kind: "consensus",
        label: "Council response",
        instructions: "Review the organization and raise any objection.",
        audience: { kind: "executive_council" },
        destination: { kind: "external", email: "council@example.test" },
        durationDays: 1,
        objectionHandling: "hold_for_resolution",
      },
    ],
  });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO membership_workflows (id, created_at) VALUES (?, ?)").bind(workflowId, now),
    env.DB.prepare(
      `INSERT INTO membership_workflow_versions (id, workflow_id, version, name, status, definition_json, created_at, published_at)
      VALUES (?, ?, 1, ?, 'published', ?, ?, ?)`,
    ).bind(versionId, workflowId, definition.name, JSON.stringify(definition), now, now),
    env.DB.prepare("UPDATE membership_categories SET workflow_version_id = ? WHERE code = 'F'").bind(versionId),
  ]);
  const formSubmissionId = await createApplicationFormSubmission({});
  const applicationId = await seedMemberApplication({
    applicantEmail: "applicant@example.test",
    applicantName: "Example User",
    organizationName: "Example Organization",
    organizationDomain: "example.test",
    membershipCategory: "F",
    formSubmissionId,
    stage: "processing",
  });
  const category = await requireMembershipCategory(env.DB, "F");
  await env.DB.batch(
    prepareMembershipWorkflowPin(
      env.DB,
      applicationId,
      category,
      await getMembershipWorkflowVersion(env.DB, versionId),
      1,
      now,
    ),
  );
  async function call(path: string, body: unknown, authenticated = true) {
    return app.fetch(
      new Request(`https://app.test/api/v1/members/applications/${applicationId}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
      env as any,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
  }
  const active = await getMembershipExecution(env.DB, applicationId);
  expect(active.steps[0].state).toBe("waiting");
  expect(
    (
      await call(
        "/reviews/completion",
        { expectedRevision: active.revision, reason: "The organization form is complete." },
        false,
      )
    ).status,
  ).toBe(401);
  const reviewResponse = await app.fetch(
    new Request(`https://app.test/api/v1/members/applications/${applicationId}/reviews/current`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env as any,
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
  expect(await reviewResponse.json()).toMatchObject({ capabilities: { completeReview: true } });
  const outsiderId = await insertUser(env.DB, "non-reviewer@example.test");
  await seatInExecutiveCouncil(env.DB, outsiderId);
  const outsiderToken = await createMemberSession(env.DB, outsiderId, "non-reviewer");
  const denied = await app.fetch(
    new Request(`https://app.test/api/v1/members/applications/${applicationId}/reviews/completion`, {
      method: "POST",
      headers: { authorization: `Bearer ${outsiderToken}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: active.revision, reason: "An unrelated user cannot approve." }),
    }),
    env as any,
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
  expect(denied.status).toBe(403);
  const completion = await call("/reviews/completion", {
    expectedRevision: active.revision,
    reason: "The organization form is complete.",
  });
  expect(completion.status, await completion.clone().text()).toBe(200);
  const review = await getMembershipExecution(env.DB, applicationId);
  expect(review.currentPosition).toBe(1);
  expect(review.steps[1]).toMatchObject({ state: "active", opened_at: null, notice_status: "queued" });
  await evaluateMembershipApplication(env.DB, applicationId, "https://app.test");
  expect((await getMembershipExecution(env.DB, applicationId)).revision).toBe(review.revision);
  const reviewerId = await insertUser(env.DB, "council-reviewer@example.test");
  await seatInExecutiveCouncil(env.DB, reviewerId);
  const reviewerList = await app.fetch(
    new Request(`https://app.test/api/v1/members/applications/${applicationId}/reviews/users?q=council-reviewer`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env as any,
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
  expect(reviewerList.status, await reviewerList.clone().text()).toBe(200);
  expect(await reviewerList.json()).toMatchObject({ users: [{ id: reviewerId }] });
  const gate = gateNextBatch(env.DB);
  const racing = recordMembershipObjection(
    gate.db,
    applicationId,
    {
      userId: admin.id,
      staff: { identityType: "user", id: admin.id, email: "admin@pkic.org", role: "admin" },
    },
    {
      expectedRevision: review.revision,
      onBehalfOfUserId: reviewerId,
      body: "Check the organization ownership",
      reason: "Received outside the portal",
    },
    "https://app.test",
  ).then(
    () => null,
    (error: unknown) => error,
  );
  await gate.reached;
  await unseatFromExecutiveCouncil(env.DB, reviewerId);
  gate.release();
  expect(await racing).toMatchObject({ status: 409 });
  expect(
    await queryAll(env.DB, "SELECT id FROM membership_application_objections WHERE application_id = ?", applicationId),
  ).toHaveLength(0);
  await seatInExecutiveCouncil(env.DB, reviewerId);
  const objectionResponse = await call("/objections", {
    expectedRevision: review.revision,
    body: "Clarify the organization ownership.",
    onBehalfOfUserId: reviewerId,
    reason: "An eligibility detail needs review.",
  });
  expect(objectionResponse.status, await objectionResponse.clone().text()).toBe(200);
  const { objectionId } = (await objectionResponse.json()) as { objectionId: string };
  const objections = await app.fetch(
    new Request(`https://app.test/api/v1/members/applications/${applicationId}/objections`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env as any,
    { waitUntil() {}, passThroughOnException() {} } as any,
  );
  expect(objections.status, await objections.clone().text()).toBe(200);
  expect(await objections.json()).toMatchObject({
    objections: [{ id: objectionId, authorUserId: reviewerId, recordedByUserId: admin.id }],
  });
  const sentAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await env.DB.prepare("UPDATE email_outbox SET status = 'sent', sent_at = ? WHERE id = ?")
    .bind(sentAt, review.steps[1].notice_outbox_id)
    .run();
  await evaluateMembershipApplication(env.DB, applicationId, "https://app.test");
  const blocked = await getMembershipExecution(env.DB, applicationId);
  expect(blocked.application.stage).toBe("processing");
  expect(blocked.steps[1].deadline_at).toBe(new Date(Date.parse(sentAt) + 86_400_000).toISOString());
  const resolved = await call(`/objections/${objectionId}/resolution`, {
    expectedRevision: blocked.revision,
    resolution: "resolved",
    reason: "The organization supplied the requested ownership evidence.",
  });
  expect(resolved.status, await resolved.clone().text()).toBe(200);
  expect(await resolved.json()).toMatchObject({ approved: true });
  expect((await getMembershipExecution(env.DB, applicationId)).application.stage).toBe("approved");
  expect(
    await queryAll(
      env.DB,
      "SELECT id FROM members WHERE organization_id IN (SELECT id FROM organizations WHERE normalized_name = 'example organization')",
    ),
  ).toHaveLength(1);
  expect(
    (
      await call(`/objections/${objectionId}/resolution`, {
        expectedRevision: blocked.revision,
        resolution: "resolved",
        reason: "Duplicate callback.",
      })
    ).status,
  ).toBe(409);
});
