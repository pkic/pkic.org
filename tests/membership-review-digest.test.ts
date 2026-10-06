import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { membershipWorkflowMigrationPreviewResponseSchema } from "../assets/shared/schemas/membership-workflow-migration";
import { applicationStageTransitionSchema } from "../assets/shared/schemas/membership-application-management";
import { emailOutboxIdSchema } from "../assets/shared/schemas/email-outbox";
import { membershipReviewDigestSendAt } from "../assets/shared/membership-review-notifications";
import { processPendingOutbox, processOutboxById } from "../functions/_lib/email/outbox";
import type { Env } from "../functions/_lib/types";
import { requireMembershipCategory } from "../functions/_lib/services/membership/categories";
import {
  requireCategoryWorkflow,
  prepareMembershipWorkflowPin,
} from "../functions/_lib/services/membership/workflows/pinning";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";
import { getMembershipExecution } from "../functions/_lib/services/membership/workflows/execution";
import { createTemplateVersion, activateTemplateVersion, resolveTemplate } from "../functions/_lib/email/templates";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { seedMemberApplication, createApplicationFormSubmission } from "./helpers/member-applications";
import { gateBatchGroup, gateNextFirst } from "./helpers/d1-batch-gate";

let today: string;
beforeEach(async () => {
  await resetDb();
  await seedDigestTemplates();
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 1);
  future.setUTCHours(12, 0, 0, 0);
  today = future.toISOString();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(future);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function reviewedApplication(name: string, council = false) {
  const id = await seedMemberApplication({
    applicantEmail: `${crypto.randomUUID()}@example.test`,
    applicantName: "Example User",
    organizationName: name,
    organizationDomain: null,
    membershipCategory: "F",
    stage: "processing",
  });
  const category = await requireMembershipCategory(env.DB, "F");
  await env.DB.batch(
    prepareMembershipWorkflowPin(env.DB, id, category, await requireCategoryWorkflow(env.DB, category), 1, today),
  );
  await env.DB.prepare(
    "UPDATE membership_application_steps SET state = 'complete', completed_at = ? WHERE application_id = ? AND position < ?",
  )
    .bind(today, id, council ? 2 : 1)
    .run();
  return id;
}

async function seedDigestTemplates() {
  const migration = env.TEST_MIGRATIONS.find((item) => item.name === "0038_membership_review_digest_template.sql")!;
  for (const query of migration.queries) await env.DB.prepare(query).run();
  const layout = await createTemplateVersion(env.DB, {
    templateKey: "email_layout",
    content: "{{{body_html}}}",
    createdByUserId: null,
  });
  await activateTemplateVersion(env.DB, { templateKey: "email_layout", version: layout.version });
}

async function prepareWorkflowRestart(id: string, changePolicy = false) {
  await seedEventAndAdmin(env.DB);
  const [reviewer] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  const token = await createAdminSession(env.DB, reviewer.id, "digest-workflow-reviewer");
  const execution = await getMembershipExecution(env.DB, id);
  let versionId = execution.version.id;
  if (changePolicy) {
    const workflowId = crypto.randomUUID();
    versionId = crypto.randomUUID();
    const definition = {
      ...execution.version.definition,
      steps: execution.version.definition.steps.map((step) =>
        step.kind === "consensus"
          ? {
              ...step,
              destination: { kind: "external", email: "new-reviewers@example.test" },
              durationDays: 3,
              instructions: "Review the corrected application form under the new policy.",
            }
          : step,
      ),
    };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO membership_workflows (id, created_at) VALUES (?, ?)").bind(workflowId, today),
      env.DB.prepare(
        `INSERT INTO membership_workflow_versions (id, workflow_id, version, name, status, definition_json, created_at, published_at)
        VALUES (?, ?, 1, ?, 'published', ?, ?, ?)`,
      ).bind(versionId, workflowId, definition.name, JSON.stringify(definition), today, today),
    ]);
  }
  const base = `https://app.test/api/v1/members/applications/${id}/workflow/migration`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const previewResponse = await app.fetch(
    new Request(`${base}?versionId=${versionId}`, { headers }),
    env as Env,
    createExecutionContext(),
  );
  expect(previewResponse.status).toBe(200);
  const preview = membershipWorkflowMigrationPreviewResponseSchema.parse(await previewResponse.json());
  const body = JSON.stringify({
    versionId,
    previewFingerprint: preview.fingerprint,
    acknowledgeRestart: true,
    reason: "Restart the example organization's application under the selected review policy.",
  });
  return () => app.fetch(new Request(base, { method: "POST", headers, body }), env as Env, createExecutionContext());
}

/** Exercise staff stage changes through the canonical authenticated endpoint. */
async function prepareStageChange(id: string) {
  await seedEventAndAdmin(env.DB);
  const [reviewer] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  return async (toStage: ReturnType<typeof applicationStageTransitionSchema.parse>["toStage"]) => {
    const token = await createAdminSession(env.DB, reviewer.id, crypto.randomUUID());
    const context = createExecutionContext();
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/members/applications/${id}/stage`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(
          applicationStageTransitionSchema.parse({
            toStage,
            ...(toStage === "on_hold" ? { onHoldSubtype: "request_information" } : {}),
            note: "Update the example organization's application after reviewing its form.",
          }),
        ),
      }),
      env as Env,
      context,
    );
    await waitOnExecutionContext(context);
    return response;
  };
}

interface DigestRow {
  id: string;
  recipient_email: string;
  subject: string;
  payload_json: string;
  send_after: string;
  created_at: string;
  status: string;
}
function digests() {
  return queryAll<DigestRow>(
    env.DB,
    "SELECT id, recipient_email, subject, payload_json, send_after, created_at, status FROM email_outbox WHERE template_key = 'membership-workflow-review-digest' ORDER BY recipient_email, id",
  );
}

it("combines concurrent organization reviews and starts both full windows only after successful digest delivery", async () => {
  const ids = await Promise.all([
    reviewedApplication("Example Organization"),
    reviewedApplication("Second Organization"),
  ]);
  const db = gateBatchGroup(env.DB, 2);
  await Promise.all(ids.map((id) => evaluateMembershipApplication(db, id, "https://app.test")));
  const [digest] = await digests();
  expect(await digests()).toHaveLength(1);
  expect(digest).toMatchObject({
    recipient_email: "consultation@lists.pkic.org",
    status: "queued",
    created_at: today,
    send_after: membershipReviewDigestSendAt(today),
  });
  expect(emailOutboxIdSchema.safeParse(digest.id).success).toBe(true);
  expect(digest.subject).toContain(today.slice(0, 10));
  expect(JSON.parse(digest.payload_json)).not.toHaveProperty("__directBodyContent");
  for (const id of ids) {
    const execution = await getMembershipExecution(env.DB, id);
    expect(execution.steps[1]).toMatchObject({ notice_outbox_id: digest.id, opened_at: null, deadline_at: null });
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
  }
  const send = vi
    .fn()
    .mockResolvedValueOnce(new Response("Try again", { status: 500 }))
    .mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "digest-message" } }));
  vi.stubGlobal("fetch", send);
  await seedDigestTemplates();
  const baseline = await resolveTemplate(env.DB, "membership-workflow-review-digest");
  const customized = await createTemplateVersion(env.DB, {
    templateKey: "membership-workflow-review-digest",
    content: `${baseline.content}\n\nQuestions? Contact the membership team.`,
    subjectTemplate: "Review forms: {{stepLabel}} — {{reviewDate}} UTC",
    fromEmail: "membership@example.test",
    fromName: "Membership Team",
    createdByUserId: null,
  });
  await activateTemplateVersion(env.DB, {
    templateKey: "membership-workflow-review-digest",
    version: customized.version,
  });
  // Reapplying the seed must preserve the administrator's active version.
  await seedDigestTemplates();
  expect(await processPendingOutbox(env.DB, env as Env)).toEqual({ processed: 0, failed: 0 });
  expect(send).not.toHaveBeenCalled();
  vi.setSystemTime(new Date(digest.send_after));
  expect(await processPendingOutbox(env.DB, env as Env)).toEqual({ processed: 1, failed: 1 });
  for (const id of ids) {
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
    expect((await getMembershipExecution(env.DB, id)).steps[1].opened_at).toBeNull();
  }
  const [retry] = await digests();
  expect(retry.status).toBe("retrying");
  const deliveredAt = new Date(Date.parse(retry.send_after) + 86400_000).toISOString();
  vi.setSystemTime(new Date(deliveredAt));
  expect(await processPendingOutbox(env.DB, env as Env)).toEqual({ processed: 1, failed: 0 });
  expect(await processPendingOutbox(env.DB, env as Env)).toEqual({ processed: 0, failed: 0 });
  expect(send).toHaveBeenCalledTimes(2);
  const message = JSON.parse(String(send.mock.calls[1][1].body));
  const html = message.content.find((part: { type: string }) => part.type === "text/html").value;
  expect(html).toContain("Example Organization");
  expect(html).toContain("Second Organization");
  expect(html).toContain("Below you will find the complete application details:");
  expect(html).toContain("Dear Members,");
  expect(html).toContain("Questions? Contact the membership team.");
  const closesOn = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.parse(deliveredAt) + 7 * 86400_000));
  expect(html).toContain(`will close on ${closesOn} (UTC)`);
  expect(message.subject).toContain(`Review forms: Member consultation — ${today.slice(0, 10)} UTC`);
  expect(message.from).toEqual({ email: "membership@example.test", name: "Membership Team" });
  expect(
    await env.DB.prepare("SELECT template_version FROM email_outbox WHERE id = ?")
      .bind(digest.id)
      .first("template_version"),
  ).toBe(customized.version);
  expect(html).toContain("Example User");
  for (const id of ids) {
    expect(html).toContain(`/membership/applications/${id}/review`);
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
    expect((await getMembershipExecution(env.DB, id)).steps[1]).toMatchObject({
      opened_at: deliveredAt,
      deadline_at: new Date(Date.parse(deliveredAt) + 7 * 86400_000).toISOString(),
    });
  }
});

it("keeps council notices separate, combines them, and uses a new digest for the next UTC day", async () => {
  const memberId = await reviewedApplication("Member Organization");
  const councilIds = await Promise.all([
    reviewedApplication("Council Organization One", true),
    reviewedApplication("Council Organization Two", true),
  ]);
  for (const id of [memberId, ...councilIds]) await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const rows = await digests();
  expect(rows).toHaveLength(2);
  const council = rows.find((row) => row.recipient_email === "ec@lists.pkic.org")!;
  expect(council.payload_json).toContain("Council Organization One");
  expect(council.payload_json).toContain("Council Organization Two");
  expect(council.payload_json).not.toContain("Member Organization");
  vi.setSystemTime(new Date(membershipReviewDigestSendAt(today)));
  const next = await reviewedApplication("Next Day Organization");
  await evaluateMembershipApplication(env.DB, next, "https://app.test");
  expect(await digests()).toHaveLength(3);
  expect((await getMembershipExecution(env.DB, next)).steps[1].notice_outbox_id).not.toBe(
    rows.find((row) => row.recipient_email === "consultation@lists.pkic.org")!.id,
  );
});

it("rolls back the step advance when appending fails, and never mutates a digest claimed for sending", async () => {
  const first = await reviewedApplication("First Organization");
  await evaluateMembershipApplication(env.DB, first, "https://app.test");
  const [original] = await digests();
  const second = await reviewedApplication("Second Organization");
  await env.DB.prepare(
    `CREATE TRIGGER reject_digest_append BEFORE UPDATE ON email_outbox BEGIN SELECT RAISE(ABORT, 'forced digest failure'); END`,
  ).run();
  try {
    await expect(evaluateMembershipApplication(env.DB, second, "https://app.test")).rejects.toThrow(
      "forced digest failure",
    );
  } finally {
    await env.DB.prepare("DROP TRIGGER reject_digest_append").run();
  }
  expect((await digests())[0].payload_json).toBe(original.payload_json);
  expect((await getMembershipExecution(env.DB, second)).steps[1].state).toBe("waiting");
  await env.DB.prepare("UPDATE email_outbox SET status = 'sending' WHERE id = ?").bind(original.id).run();
  await expect(evaluateMembershipApplication(env.DB, second, "https://app.test")).rejects.toMatchObject({
    code: "MEMBERSHIP_WORKFLOW_CHANGED",
  });
  expect((await getMembershipExecution(env.DB, second)).steps[1].notice_outbox_id).toBeNull();
  expect((await digests())[0].payload_json).toBe(original.payload_json);
});

it("escapes untrusted names and rejects a stale command whose digest is already due", async () => {
  const id = await reviewedApplication("Example <img src=x onerror=alert(1)> [Organization](https://evil.test)");
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [digest] = await digests();
  const payload = JSON.parse(digest.payload_json);
  expect(payload.applicationDetails).toContain("&lt;img");
  expect(payload.applicationSummary).toContain("\\[Organization\\]");
  const next = await reviewedApplication("Later Organization");
  await env.DB.prepare("UPDATE email_outbox SET send_after = '2000-01-01T00:00:00.000Z' WHERE id = ?")
    .bind(digest.id)
    .run();
  await expect(evaluateMembershipApplication(env.DB, next, "https://app.test")).rejects.toMatchObject({
    code: "MEMBERSHIP_WORKFLOW_CHANGED",
  });
  expect((await getMembershipExecution(env.DB, next)).steps[1].state).toBe("waiting");
});

it("replaces an application's earlier snapshot when its workflow restarts before dispatch", async () => {
  const id = await reviewedApplication("Original Organization");
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [original] = await digests();
  const restart = await prepareWorkflowRestart(id);
  expect((await restart()).status).toBe(200);
  expect((await digests())[0].status).toBe("cancelled");
  await env.DB.batch([
    env.DB.prepare("UPDATE member_applications SET organization_name = 'Corrected Organization' WHERE id = ?").bind(id),
    env.DB.prepare(
      "UPDATE membership_application_steps SET state = 'complete', completed_at = ? WHERE application_id = ? AND generation = 2 AND position = 0",
    ).bind(today, id),
  ]);
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [updated] = await digests();
  expect(await digests()).toHaveLength(1);
  expect(updated.id).toBe(original.id);
  expect(updated.status).toBe("queued");
  expect(updated.payload_json).toContain("Corrected Organization");
  expect(updated.payload_json).not.toContain("Original Organization");
  expect(Object.keys(JSON.parse(updated.payload_json).reviewApplications)).toEqual([id]);
});

it.each([false, true])(
  "removes the old policy snapshot atomically while preserving a shared digest: %s",
  async (shared) => {
    const id = await reviewedApplication("Moving Organization");
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
    if (shared) {
      const peer = await reviewedApplication("Remaining Organization");
      await evaluateMembershipApplication(env.DB, peer, "https://app.test");
    }
    const [old] = await digests();
    const restart = await prepareWorkflowRestart(id, true);
    expect((await restart()).status).toBe(200);
    const [cleaned] = await digests();
    expect(cleaned.status).toBe(shared ? "queued" : "cancelled");
    expect(cleaned.payload_json).not.toContain("Moving Organization");
    const payload = JSON.parse(cleaned.payload_json);
    expect(payload.reviewApplications[id]).toBeUndefined();
    expect(payload.applicationSummary).toEqual(shared ? expect.stringContaining("Remaining Organization") : "");
    expect(payload.applicationDetails).toEqual(shared ? expect.stringContaining("Remaining Organization") : "");
    await env.DB.prepare(
      "UPDATE membership_application_steps SET state = 'complete', completed_at = ? WHERE application_id = ? AND generation = 2 AND position = 0",
    )
      .bind(today, id)
      .run();
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
    const rows = await digests();
    const replacement = rows.find((row) => row.id !== old.id)!;
    expect(replacement.recipient_email).toBe("new-reviewers@example.test");
    expect(replacement.payload_json).toContain("Moving Organization");
    expect(rows.find((row) => row.id === old.id)!.payload_json).not.toContain("Moving Organization");
  },
);

it("rolls digest cleanup and the workflow restart back together when the audit fails", async () => {
  const id = await reviewedApplication("Example Organization");
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [old] = await digests();
  const restart = await prepareWorkflowRestart(id, true);
  await env.DB.prepare(
    `CREATE TRIGGER reject_workflow_restart_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'membership_workflow_migrated' BEGIN SELECT RAISE(ABORT, 'forced restart failure'); END`,
  ).run();
  try {
    expect((await restart()).status).toBe(500);
    expect((await getMembershipExecution(env.DB, id)).generation).toBe(1);
    expect((await digests())[0]).toEqual(old);
  } finally {
    await env.DB.prepare("DROP TRIGGER reject_workflow_restart_audit").run();
  }
});

it("uses the cleaned payload when delivery selected a shared digest before the restart", async () => {
  const moved = await reviewedApplication("Moving Organization");
  const peer = await reviewedApplication("Remaining Organization");
  for (const id of [moved, peer]) await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [digest] = await digests();
  await seedDigestTemplates();
  const send = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "cleaned-digest" } }));
  vi.stubGlobal("fetch", send);
  vi.setSystemTime(new Date(digest.send_after));
  const gate = gateNextFirst(env.DB, "RETURNING payload_json");
  const delivery = processPendingOutbox(gate.db, env as Env);
  await gate.reached;
  try {
    const restart = await prepareWorkflowRestart(moved, true);
    expect((await restart()).status).toBe(200);
  } finally {
    gate.release();
  }
  expect(await delivery).toEqual({ processed: 1, failed: 0 });
  expect(send).toHaveBeenCalledTimes(1);
  const sentBody = String(send.mock.calls[0][1].body);
  expect(sentBody).toContain("Remaining Organization");
  expect(sentBody).not.toContain("Moving Organization");
});

it("refuses a workflow restart during an active send and preserves a sent notice", async () => {
  const id = await reviewedApplication("Sending Organization");
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [digest] = await digests();
  await seedDigestTemplates();
  vi.setSystemTime(new Date(digest.send_after));
  let reached!: () => void;
  let accept!: (response: Response) => void;
  const sending = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const accepted = new Promise<Response>((resolve) => {
    accept = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      reached();
      return accepted;
    }),
  );
  const delivery = processPendingOutbox(env.DB, env as Env);
  await sending;
  const restart = await prepareWorkflowRestart(id, true);
  try {
    expect((await restart()).status).toBe(409);
    expect((await getMembershipExecution(env.DB, id)).generation).toBe(1);
  } finally {
    accept(new Response(null, { status: 202, headers: { "x-message-id": "sent-notice" } }));
  }
  expect(await delivery).toEqual({ processed: 1, failed: 0 });
  expect((await restart()).status).toBe(200);
  const [sent] = await digests();
  expect(sent.status).toBe("sent");
  expect(sent.payload_json).toBe(digest.payload_json);
});

it.each([
  ["declined", false],
  ["declined", true],
  ["withdrawn", false],
  ["withdrawn", true],
  ["on_hold", false],
  ["on_hold", true],
] as const)("removes %s applications from unsent digests (shared: %s)", async (stage, shared) => {
  const id = await reviewedApplication("Removed Organization");
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  if (shared) {
    const peer = await reviewedApplication("Remaining Organization");
    await evaluateMembershipApplication(env.DB, peer, "https://app.test");
  }
  if (stage === "withdrawn" && shared) {
    await env.DB.prepare(
      "UPDATE email_outbox SET status = 'retrying' WHERE template_key = 'membership-workflow-review-digest'",
    ).run();
  }
  const [original] = await digests();
  const changeStage = await prepareStageChange(id);
  expect((await changeStage(stage)).status).toBe(200);
  const [cleaned] = await digests();
  expect(cleaned.status).toBe(shared ? original.status : "cancelled");
  expect(cleaned.payload_json).not.toContain("Removed Organization");
  const payload = JSON.parse(cleaned.payload_json);
  expect(payload.reviewApplications[id]).toBeUndefined();
  expect(payload.applicationSummary).toEqual(shared ? expect.stringContaining("Remaining Organization") : "");
  expect(payload.applicationDetails).toEqual(shared ? expect.stringContaining("Remaining Organization") : "");
  const execution = await getMembershipExecution(env.DB, id);
  expect(execution.application.stage).toBe(stage);
  if (stage === "on_hold") expect(execution.steps[1]).toMatchObject({ state: "waiting", notice_outbox_id: null });
  await seedDigestTemplates();
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", send);
  vi.setSystemTime(new Date(original.send_after));
  await processOutboxById(env.DB, env as Env, original.id);
  expect(send).toHaveBeenCalledTimes(shared ? 1 : 0);
  if (shared) {
    expect(String(send.mock.calls[0][1].body)).toContain("Remaining Organization");
    expect(String(send.mock.calls[0][1].body)).not.toContain("Removed Organization");
  }
});

it("queues a fresh daily notice and full review window when an unsent held review resumes", async () => {
  const id = await reviewedApplication("Resumed Organization");
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [original] = await digests();
  const changeStage = await prepareStageChange(id);
  expect((await changeStage("on_hold")).status).toBe(200);
  vi.setSystemTime(new Date(original.send_after));
  expect((await changeStage("processing")).status).toBe(200);
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const replacement = (await digests()).find((row) => row.id !== original.id)!;
  expect(replacement.status).toBe("queued");
  expect(replacement.payload_json).toContain("Resumed Organization");
  expect((await getMembershipExecution(env.DB, id)).steps[1]).toMatchObject({
    state: "active",
    notice_outbox_id: replacement.id,
    opened_at: null,
    deadline_at: null,
  });
  await seedDigestTemplates();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  vi.setSystemTime(new Date(replacement.send_after));
  await processOutboxById(env.DB, env as Env, replacement.id);
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  expect((await getMembershipExecution(env.DB, id)).steps[1]).toMatchObject({
    opened_at: replacement.send_after,
    deadline_at: new Date(Date.parse(replacement.send_after) + 7 * 86400_000).toISOString(),
  });
});

it("rolls stage changes and digest cleanup back together if their audit fails", async () => {
  const id = await reviewedApplication("Unchanged Organization");
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [original] = await digests();
  const before = await getMembershipExecution(env.DB, id);
  const changeStage = await prepareStageChange(id);
  await env.DB.prepare(
    `CREATE TRIGGER reject_digest_stage_audit BEFORE INSERT ON audit_log
    WHEN NEW.action = 'application_stage_transitioned' BEGIN SELECT RAISE(ABORT, 'forced stage failure'); END`,
  ).run();
  try {
    expect((await changeStage("on_hold")).status).toBe(500);
    expect((await digests())[0]).toEqual(original);
    const after = await getMembershipExecution(env.DB, id);
    expect(after.application.stage).toBe(before.application.stage);
    expect(after.revision).toBe(before.revision);
    expect(after.steps[1]).toEqual(before.steps[1]);
  } finally {
    await env.DB.prepare("DROP TRIGGER reject_digest_stage_audit").run();
  }
});

it("refuses stage changes while a digest is sending and preserves sent review evidence", async () => {
  const id = await reviewedApplication("Sending Organization");
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [original] = await digests();
  const changeStage = await prepareStageChange(id);
  await env.DB.prepare("UPDATE email_outbox SET status = 'sending' WHERE id = ?").bind(original.id).run();
  for (const stage of ["declined", "withdrawn", "on_hold"] as const) {
    expect((await changeStage(stage)).status).toBe(409);
    expect((await getMembershipExecution(env.DB, id)).application.stage).toBe("processing");
  }
  await env.DB.prepare("UPDATE email_outbox SET status = 'sent', sent_at = ? WHERE id = ?")
    .bind(today, original.id)
    .run();
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const before = (await getMembershipExecution(env.DB, id)).steps[1];
  expect((await changeStage("on_hold")).status).toBe(200);
  expect((await changeStage("processing")).status).toBe(200);
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  expect((await getMembershipExecution(env.DB, id)).steps[1]).toEqual(before);
  expect((await digests())[0].payload_json).toBe(original.payload_json);
});

it("renders three complete application forms with current labels and literal applicant text", async () => {
  const ids = await Promise.all(
    ["Example Trust Software", "Example Key Systems", "Example Identity Tools"].map((name) =>
      reviewedApplication(name),
    ),
  );
  const formSubmissionId = await createApplicationFormSubmission({
    job_title: "PKI Engineer",
    about_yourself: "I build accessible forms.\nI help users manage certificate lifecycles.",
    organization_website: "https://example.test/",
    reason: "Collaborate on PKI standards.",
    contribution_type: "active",
    wants_to_present: true,
    interested_in_sponsoring: false,
    about_organization: '<script>alert("example")</script> [Untrusted link](https://hostile.test/) {{instructions}}',
  });
  await env.DB.prepare("UPDATE member_applications SET form_submission_id = ? WHERE id = ?")
    .bind(formSubmissionId, ids[0])
    .run();
  for (const id of ids) await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [digest] = await digests();
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", send);
  vi.setSystemTime(new Date(digest.send_after));
  await processOutboxById(env.DB, env as Env, digest.id);
  const message = JSON.parse(String(send.mock.calls[0][1].body));
  const html = message.content.find((part: { type: string }) => part.type === "text/html").value;
  expect(html).toContain("Dear Members,");
  expect(html).toContain("Applications must be approved by the Executive Council after feedback from the Members.");
  expect(html).toContain("not on selling products or services");
  for (const name of ["Example Trust Software", "Example Key Systems", "Example Identity Tools"]) {
    expect(html.match(new RegExp(`Membership application from ${name}`, "g"))).toHaveLength(2);
  }
  expect(html).toContain("PKI or cryptographic software and device providers");
  expect(html).toContain("Role / Job Title: PKI Engineer");
  expect(html).toContain("I build accessible forms.");
  expect(html).toContain("I help users manage certificate lifecycles.");
  expect(html).toContain("Actively contribute to the consortium and its mission");
  expect(html).toContain("I would like to introduce myself: Yes");
  expect(html).toContain("I would like to discuss sponsoring: No");
  expect(html).toContain("I agree to follow the Bylaws: Yes");
  expect(html).toContain("Best regards,");
  const text = message.content.find((part: { type: string }) => part.type === "text/plain").value;
  expect(text).toContain("each application's review page");
  expect(text).toContain('alert("example")');
  expect(text).not.toContain("&#39;");
  expect(text).not.toContain("&quot;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="https://hostile.test/"');
  expect(html).toContain("{{instructions}}");
});
