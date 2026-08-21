import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { EMAIL_OUTBOX_DUE_QUERY } from "../functions/_lib/email/outbox";
import { GOOGLE_GROUPS_DUE_QUERY } from "../functions/_lib/services/google-groups";
import { STORAGE_DELETION_DUE_QUERY } from "../functions/_lib/services/storage-deletion-outbox";
import { BADGE_RENDER_DUE_QUERY } from "../functions/_lib/services/registration-badge-regeneration";
import { WG_CHAIR_DIGEST_CHANGE_EVENTS_QUERY } from "../functions/_lib/services/wg-chair-digest";

async function explain(
  sql: string,
  bindings: unknown[] = [new Date().toISOString(), new Date().toISOString(), 20],
): Promise<string> {
  const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...bindings)
    .all<{ detail: string }>();
  return result.results.map((row) => row.detail).join("\n");
}

function expectBoundedDuePlan(plan: string, indexes: string[], table: string): void {
  for (const index of indexes) expect(plan).toContain(index);
  expect(plan).not.toMatch(new RegExp(`(?:^|\\n)SCAN ${table}(?:$|\\s)`));
  expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
}

describe("durable external-effect due query plans", () => {
  beforeEach(resetDb);

  it("uses branch-specific indexes for Google Groups due and expired-lease rows", async () => {
    expectBoundedDuePlan(
      await explain(GOOGLE_GROUPS_DUE_QUERY),
      ["idx_google_groups_sync_queue_due", "idx_google_groups_sync_queue_expired_lease"],
      "google_groups_sync_queue",
    );
  });

  it("uses branch-specific indexes for email due and expired-lease rows", async () => {
    expectBoundedDuePlan(
      await explain(EMAIL_OUTBOX_DUE_QUERY),
      ["idx_email_outbox_due", "idx_email_outbox_expired_lease"],
      "email_outbox",
    );
  });

  it("uses branch-specific indexes for storage deletion due and expired-lease rows", async () => {
    expectBoundedDuePlan(
      await explain(STORAGE_DELETION_DUE_QUERY),
      ["idx_storage_deletion_outbox_due", "idx_storage_deletion_outbox_expired_lease"],
      "storage_deletion_outbox",
    );
  });

  it("uses branch-specific indexes for badge due and expired-lease rows", async () => {
    expectBoundedDuePlan(
      await explain(BADGE_RENDER_DUE_QUERY),
      ["idx_badge_render_jobs_due", "idx_badge_render_jobs_expired_lease"],
      "badge_render_jobs",
    );
  });

  it("uses both working-group digest time-window indexes", async () => {
    const start = "2026-08-03T08:00:00.000Z";
    const end = "2026-08-10T08:00:00.000Z";
    const plan = await explain(WG_CHAIR_DIGEST_CHANGE_EVENTS_QUERY, [start, end, start, end]);

    expect(plan).toContain("idx_wg_members_joined_window");
    expect(plan).toContain("idx_wg_members_left_window");
    expect(plan).not.toMatch(/(?:^|\n)SCAN wgm(?:$|\s)/);
  });
});
