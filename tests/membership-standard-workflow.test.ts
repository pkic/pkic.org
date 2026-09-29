import { expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createApplicationFormSubmission, seedMemberApplication } from "./helpers/member-applications";
import { requireMembershipCategory } from "../functions/_lib/services/membership/categories";
import { getMembershipWorkflowVersion } from "../functions/_lib/services/membership/workflows/catalog";
import { prepareMembershipWorkflowPin } from "../functions/_lib/services/membership/workflows/pinning";
import { getMembershipExecution } from "../functions/_lib/services/membership/workflows/execution";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";

it("runs the standard staff, voting-member, and council requirements with independent full notice windows", async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  const token = await createAdminSession(env.DB, admin.id, "standard-workflow");
  const category = await requireMembershipCategory(env.DB, "F");
  const version = await getMembershipWorkflowVersion(env.DB, category.workflowVersionId!);
  const id = await seedMemberApplication({
    applicantEmail: "user@example.test",
    applicantName: "Example User",
    organizationName: "Example Organization",
    organizationDomain: "example.test",
    membershipCategory: "F",
    stage: "submitted",
    formSubmissionId: await createApplicationFormSubmission({}),
  });
  await env.DB.batch(prepareMembershipWorkflowPin(env.DB, id, category, version, 1, new Date().toISOString()));
  async function call(path: string, method: string, body?: unknown) {
    return app.fetch(
      new Request(`https://app.test/api/v1/members/applications/${id}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env as any,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
  }
  expect((await call("", "PATCH", { applicantName: "Corrected Example User" })).status).toBe(200);
  expect((await call("", "PATCH", { membershipCategory: "A" })).status).toBe(422);
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const initial = await getMembershipExecution(env.DB, id);
  const completed = await call("/reviews/completion", "POST", {
    expectedRevision: initial.revision,
    reason: "Verified the form and the user's authority for Example Organization.",
  });
  expect(completed.status, await completed.clone().text()).toBe(200);
  expect((await call("", "PATCH", { applicantName: "Changed after review" })).status).toBe(409);
  for (const position of [1, 2]) {
    const execution = await getMembershipExecution(env.DB, id);
    expect(execution.currentPosition).toBe(position);
    expect(execution.steps[position].notice_status).toBe("queued");
    expect(execution.steps[position].opened_at).toBeNull();
    const noticeId = execution.steps[position].notice_outbox_id;
    await env.DB.prepare("UPDATE email_outbox SET status = 'failed' WHERE id = ?").bind(noticeId).run();
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
    expect((await getMembershipExecution(env.DB, id)).currentPosition).toBe(position);
    const freshSentAt = new Date().toISOString();
    await env.DB.prepare("UPDATE email_outbox SET status = 'sent', sent_at = ? WHERE id = ?")
      .bind(freshSentAt, noticeId)
      .run();
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
    const waiting = await getMembershipExecution(env.DB, id);
    expect(waiting.application.stage).toBe("processing");
    expect(waiting.steps[position].deadline_at).toBe(new Date(Date.parse(freshSentAt) + 7 * 86400_000).toISOString());
    // Advance only this synthetic notice's clock; the published policy remains unchanged.
    const elapsed = new Date(Date.now() - 8 * 86400_000).toISOString();
    await env.DB.prepare("UPDATE email_outbox SET sent_at = ? WHERE id = ?").bind(elapsed, noticeId).run();
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
  }
  const approved = await getMembershipExecution(env.DB, id);
  expect(approved.application.stage).toBe("approved");
  expect(approved.steps.every((step) => step.completed_at !== null)).toBe(true);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first("count")).toBe(1);
});
