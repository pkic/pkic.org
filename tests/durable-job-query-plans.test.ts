import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { EMAIL_OUTBOX_DUE_QUERY, EMAIL_OUTBOX_EXPIRED_LEASE_QUERY } from "../functions/_lib/email/outbox";
import { GOOGLE_GROUPS_DUE_QUERY } from "../functions/_lib/services/google-groups";
import { STORAGE_DELETION_DUE_QUERY } from "../functions/_lib/services/storage-deletion-outbox";
import { BADGE_RENDER_DUE_QUERY } from "../functions/_lib/services/registration-badge-regeneration";
import { WG_CHAIR_DIGEST_CHANGE_EVENTS_QUERY } from "../functions/_lib/services/wg-chair-digest";
import {
  RSVP_ACTION_DUE_QUERY,
  RSVP_BOUNCE_DUE_QUERY,
  RSVP_WARNING_DUE_QUERY,
} from "../functions/_lib/services/rsvp-enforcement/candidates";
import {
  CONSULTATION_BATCH_DUE_QUERY,
  EC_AUTO_APPROVE_DUE_QUERY,
  ON_HOLD_CLOSURE_DUE_QUERY,
  ON_HOLD_REMINDER_DUE_QUERY,
} from "../functions/_lib/services/membership/scheduled-jobs";
import { SPONSORSHIP_DUE_WORK_QUERY } from "../functions/_lib/services/sponsorship-scheduled-jobs";
import {
  VOTE_CLOSE_DUE_QUERY,
  VOTE_ELECTION_TALLY_QUERY,
  VOTE_MOTION_TALLY_QUERY,
  VOTE_OPEN_DUE_QUERY,
  VOTE_STANDING_CANDIDATES_QUERY,
} from "../functions/_lib/services/votes/closing";

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

  it("uses dedicated indexes for email due rows and expired-lease quarantine", async () => {
    expectBoundedDuePlan(
      await explain(EMAIL_OUTBOX_DUE_QUERY, [new Date().toISOString(), 20]),
      ["idx_email_outbox_due"],
      "email_outbox",
    );
    const now = new Date().toISOString();
    const expiredPlan = await explain(EMAIL_OUTBOX_EXPIRED_LEASE_QUERY, [now, now, 20, now]);
    expect(expiredPlan).toContain("idx_email_outbox_expired_lease");
    expect(expiredPlan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
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

  it("uses both canonical group-membership digest time-window indexes", async () => {
    const start = "2026-08-03T08:00:00.000Z";
    const end = "2026-08-10T08:00:00.000Z";
    const plan = await explain(WG_CHAIR_DIGEST_CHANGE_EVENTS_QUERY, [start, end, start, end]);

    expect(plan).toContain("idx_group_memberships_joined_window");
    expect(plan).toContain("idx_group_memberships_left_window");
    expect(plan).not.toMatch(/(?:^|\n)SCAN membership(?:$|\s)/);
  });

  it("uses the partial index for bounded unnotified consultation entries", async () => {
    expectBoundedDuePlan(
      await explain(CONSULTATION_BATCH_DUE_QUERY, [100]),
      ["idx_member_applications_consultation_due"],
      "member_applications",
    );
  });

  it("uses the materialized partial index for bounded sponsorship renewal work", async () => {
    expectBoundedDuePlan(
      await explain(SPONSORSHIP_DUE_WORK_QUERY, ["2026-08-21", 20]),
      ["idx_sponsorships_active_renewal_action_due"],
      "sp",
    );
  });

  it("uses separate partial indexes for bounded on-hold closure and reminder lanes", async () => {
    expectBoundedDuePlan(
      await explain(ON_HOLD_CLOSURE_DUE_QUERY, ["2026-08-14T00:00:00.000Z", 20]),
      ["idx_member_applications_on_hold_closure_due"],
      "member_applications",
    );
    expectBoundedDuePlan(
      await explain(ON_HOLD_REMINDER_DUE_QUERY, ["2026-08-14T00:00:00.000Z", "2026-08-18T00:00:00.000Z", 20]),
      ["idx_member_applications_on_hold_reminder_due"],
      "member_applications",
    );
  });

  it("uses indexed due and decline predicates for EC auto-approval", async () => {
    const plan = await explain(EC_AUTO_APPROVE_DUE_QUERY, ["2026-08-14T00:00:00.000Z", 20]);
    expectBoundedDuePlan(plan, ["idx_member_applications_stage_entered_at"], "application");
    expect(plan).toContain("idx_ec_decisions_application_decision");
  });

  it("uses branch-specific indexes for bounded RSVP enforcement", async () => {
    const now = new Date("2026-08-21T12:00:00.000Z");
    const hours = (amount: number) => new Date(now.getTime() + amount * 60 * 60 * 1000).toISOString();
    const plans = [
      await explain(RSVP_BOUNCE_DUE_QUERY, [20]),
      await explain(RSVP_WARNING_DUE_QUERY, [hours(-1), 20]),
      await explain(RSVP_ACTION_DUE_QUERY, [hours(0), 20]),
    ];
    expect(plans[0]).toContain("idx_calendar_rsvp_pending_bounce");
    expect(plans[1]).toContain("idx_calendar_rsvp_pending_warning");
    expect(plans[2]).toContain("idx_calendar_rsvp_pending_action");
    for (const plan of plans) expect(plan).not.toMatch(/(?:^|\n)SCAN rsvp(?:$|\n)/);
  });

  it("uses indexed deterministic scans for scheduled vote openings and due vote closings", async () => {
    const now = "2026-08-21T12:00:00.000Z";

    expectBoundedDuePlan(await explain(VOTE_OPEN_DUE_QUERY, [now, 20]), ["idx_votes_pending_open"], "votes");
    expectBoundedDuePlan(await explain(VOTE_CLOSE_DUE_QUERY, [now, now, 20]), ["idx_votes_pending_close"], "votes");
  });

  it("uses partial standing-candidate and covering ballot-tally indexes for scheduled vote work", async () => {
    const voteId = "00000000-0000-4000-8000-000000000001";

    expectBoundedDuePlan(
      await explain(VOTE_STANDING_CANDIDATES_QUERY, [voteId, 51]),
      ["idx_vote_candidates_standing"],
      "vote_candidates",
    );

    for (const tallyQuery of [VOTE_MOTION_TALLY_QUERY, VOTE_ELECTION_TALLY_QUERY]) {
      const plan = await explain(tallyQuery, [voteId, 1]);
      expect(plan).toContain("idx_vote_ballots_vote_round");
      expect(plan).not.toMatch(/(?:^|\n)SCAN vote_ballots(?:$|\s)/);
      expect(plan).not.toContain("USE TEMP B-TREE FOR GROUP BY");
    }
  });
});
