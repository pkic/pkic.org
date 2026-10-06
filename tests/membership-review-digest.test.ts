import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { emailOutboxIdSchema } from "../assets/shared/schemas/email-outbox";
import { membershipReviewDigestSendAt } from "../assets/shared/membership-review-notifications";
import { processPendingOutbox } from "../functions/_lib/email/outbox";
import type { Env } from "../functions/_lib/types";
import { requireMembershipCategory } from "../functions/_lib/services/membership/categories";
import {
  requireCategoryWorkflow,
  prepareMembershipWorkflowPin,
} from "../functions/_lib/services/membership/workflows/pinning";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";
import { getMembershipExecution } from "../functions/_lib/services/membership/workflows/execution";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { seedMemberApplication } from "./helpers/member-applications";
import { gateBatchGroup } from "./helpers/d1-batch-gate";

let today: string;
beforeEach(async () => {
  await resetDb();
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
    "SELECT id, recipient_email, subject, payload_json, send_after, created_at, status FROM email_outbox ORDER BY recipient_email, id",
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
  const layout = await createTemplateVersion(env.DB, {
    templateKey: "email_layout",
    content: "{{{body_html}}}",
    createdByUserId: null,
  });
  await activateTemplateVersion(env.DB, { templateKey: "email_layout", version: layout.version });
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
  vi.setSystemTime(new Date(retry.send_after));
  expect(await processPendingOutbox(env.DB, env as Env)).toEqual({ processed: 1, failed: 0 });
  expect(await processPendingOutbox(env.DB, env as Env)).toEqual({ processed: 0, failed: 0 });
  expect(send).toHaveBeenCalledTimes(2);
  const message = JSON.parse(String(send.mock.calls[1][1].body));
  const html = message.content.find((part: { type: string }) => part.type === "text/html").value;
  expect(html).toContain("Example Organization");
  expect(html).toContain("Second Organization");
  expect(html).toContain("Application details");
  expect(html).toContain("Example User");
  for (const id of ids) {
    expect(html).toContain(`/membership/applications/${id}/review`);
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
    expect((await getMembershipExecution(env.DB, id)).steps[1]).toMatchObject({
      opened_at: retry.send_after,
      deadline_at: new Date(Date.parse(retry.send_after) + 7 * 86400_000).toISOString(),
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
  const category = await requireMembershipCategory(env.DB, "F");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE membership_application_workflows SET superseded_at = ? WHERE application_id = ? AND superseded_at IS NULL",
    ).bind(today, id),
    ...prepareMembershipWorkflowPin(env.DB, id, category, await requireCategoryWorkflow(env.DB, category), 2, today),
    env.DB.prepare("UPDATE member_applications SET organization_name = 'Corrected Organization' WHERE id = ?").bind(id),
    env.DB.prepare(
      "UPDATE membership_application_steps SET state = 'complete', completed_at = ? WHERE application_id = ? AND generation = 2 AND position = 0",
    ).bind(today, id),
  ]);
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  const [updated] = await digests();
  expect(await digests()).toHaveLength(1);
  expect(updated.id).toBe(original.id);
  expect(updated.payload_json).toContain("Corrected Organization");
  expect(updated.payload_json).not.toContain("Original Organization");
  expect(Object.keys(JSON.parse(updated.payload_json).reviewApplications)).toEqual([id]);
});
