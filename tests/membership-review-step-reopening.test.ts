import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { prepareReopenUndeliveredReviewSteps } from "../functions/_lib/services/membership/workflows/review-digest-content";
import type { DatabaseLike } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import { seedMemberApplication } from "./helpers/member-applications";
import { pinCategoryWorkflow } from "./helpers/membership-workflows";

beforeEach(resetDb);

it("reopens only unopened active digest reviews in the current generation", async () => {
  const now = new Date().toISOString();
  const scenarios = [
    { label: "queued", status: "queued", reopen: true },
    { label: "retrying", status: "retrying", reopen: true },
    { label: "failed", status: "failed", reopen: true },
    { label: "cancelled after removal", status: "cancelled", reopen: true },
    { label: "sending", status: "sending" },
    { label: "delivery uncertain", status: "delivery_unknown" },
    { label: "sent", status: "sent", sent: true },
    { label: "sent evidence with failed status", status: "failed", sent: true },
    { label: "opened", status: "failed", opened: true },
    { label: "completed", status: "failed", completed: true },
    { label: "inactive", status: "failed", state: "waiting" },
    { label: "superseded", status: "failed", superseded: true },
    { label: "ordinary notice", status: "failed", payload: {} },
    { label: "invalid snapshot shape", status: "failed", payload: { reviewApplications: [] } },
  ];
  for (const scenario of scenarios) {
    const id = await seedMemberApplication({ organizationDomain: null });
    await pinCategoryWorkflow(env.DB, id);
    const noticeId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO email_outbox (id, template_key, recipient_email, payload_json, message_type, provider, status, sent_at, send_after, created_at, updated_at)
        VALUES (?, 'membership-workflow-review-digest', 'review@example.test', ?, 'transactional', 'test', ?, ?, ?, ?, ?)`).bind(
        noticeId,
        JSON.stringify(scenario.payload ?? { reviewApplications: {} }),
        scenario.status,
        scenario.sent ? now : null,
        now,
        now,
        now,
      ),
      env.DB.prepare(
        "UPDATE membership_application_steps SET state = ?, notice_outbox_id = ?, opened_at = ?, completed_at = ? WHERE application_id = ? AND position = 1",
      ).bind(scenario.state ?? "active", noticeId, scenario.opened ? now : null, scenario.completed ? now : null, id),
      env.DB.prepare("UPDATE membership_application_workflows SET superseded_at = ? WHERE application_id = ?").bind(
        scenario.superseded ? now : null,
        id,
      ),
    ]);
    const readStep = () =>
      env.DB.prepare(
        "SELECT state, notice_outbox_id, opened_at, completed_at FROM membership_application_steps WHERE application_id = ? AND position = 1",
      )
        .bind(id)
        .first();
    const before = await readStep();
    await prepareReopenUndeliveredReviewSteps(env.DB, id).run();
    expect(await readStep(), scenario.label).toEqual(
      scenario.reopen ? { state: "waiting", notice_outbox_id: null, opened_at: null, completed_at: null } : before,
    );
  }
});

it("looks up each notice by its primary key without scanning the outbox", async () => {
  const explainDb: DatabaseLike = {
    prepare: (sql) => env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`),
    batch: (statements) => env.DB.batch(statements),
  };
  const { results } = await prepareReopenUndeliveredReviewSteps(explainDb, "synthetic-application").all<{
    detail: string;
  }>();
  const plan = results.map((row) => row.detail).join("\n");
  expect(plan).toContain("CORRELATED SCALAR SUBQUERY");
  expect(plan).toMatch(/SEARCH notice USING INDEX sqlite_autoindex_email_outbox_1 \(id=\?\)/);
  expect(plan).not.toMatch(/SCAN (notice|email_outbox)/);
});
