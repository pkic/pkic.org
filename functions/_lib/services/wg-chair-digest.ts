/**
 * Weekly working-group membership-change digest for WG chairs/vice-chairs
 * (2026-07-31 manual-testing feedback).
 * "Notify the chairs when someone joins or leaves... not a spam email every
 * time there is a change" — this runs on its own weekly cron (see
 * functions/router.ts's WG_CHAIR_DIGEST_CRON) and batches every join/leave
 * from the past 7 days into one email per (working group, chair) pair,
 * mirroring the batching pattern membership-scheduled-jobs.ts's
 * runConsultationBatch/runEcReviewBatch already use for the twice-weekly
 * membership batches — same "fixed rolling window, no persisted last-run
 * state" tradeoff those two accept.
 *
 * Recipients are resolved from the same live user_roles-backed chair/
 * vice-chair data admin-working-groups.ts's listAdminWorkingGroups already
 * computes (role-wg_chair/role-wg_vice_chair, context_type='working_group')
 * — reused as-is rather than duplicating that query. Each recipient's
 * `wgChairMembershipDigest` notification preference (default true, see
 * member-self-service.ts) is checked individually before sending, so a
 * chair who opts out gets nothing even if their co-chair still does.
 */
import { all } from "../db/queries";
import { queueEmail, processOutboxByIdBackground } from "../email/outbox";
import { listAdminWorkingGroups } from "./admin-working-groups";
import { getUserNotificationPreferences } from "./member-self-service";
import { deterministicRepresentativeJoinSql } from "./membership/representative-lookup";
import type { DatabaseLike, Env } from "../types";

interface WgChangeEntry {
  name: string;
  organizationName: string | null;
}

interface WgChangeRow {
  joined_at: string;
  left_at: string | null;
  first_name: string | null;
  last_name: string | null;
  org_name: string | null;
}

function toChangeEntry(row: WgChangeRow): WgChangeEntry {
  return {
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    organizationName: row.org_name,
  };
}

export interface WgChairDigestResult {
  workingGroupsWithChanges: number;
  emailsSent: number;
}

export async function runWeeklyWgChairDigest(db: DatabaseLike, env: Env): Promise<WgChairDigestResult> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { workingGroups: groups } = await listAdminWorkingGroups(db, {
    limit: 200,
    offset: 0,
    sort: "name",
  });

  let workingGroupsWithChanges = 0;
  let emailsSent = 0;

  for (const wg of groups) {
    if (!wg.active) continue;

    const changeRows = await all<WgChangeRow>(
      db,
      `SELECT wgm.joined_at, wgm.left_at, u.first_name, u.last_name, o.name AS org_name
       FROM working_group_members wgm
       JOIN users u ON u.id = wgm.user_id
       -- A WG member can represent more than one organization at once
       -- (consolidated migration 0035) — join to a single deterministic representative
       -- row (earliest joined_at) instead of fanning out one result row
       -- (and one duplicate digest entry) per represented organization.
${deterministicRepresentativeJoinSql("wgm.user_id")}
       LEFT JOIN members m ON m.id = rep.member_id
       LEFT JOIN organizations o ON o.id = m.organization_id
       WHERE wgm.working_group_id = ?
         AND (wgm.joined_at >= ? OR (wgm.left_at IS NOT NULL AND wgm.left_at >= ?))
       ORDER BY u.last_name ASC, u.first_name ASC`,
      [wg.id, cutoff, cutoff],
    );

    const joined = changeRows.filter((r) => r.joined_at >= cutoff).map(toChangeEntry);
    const left = changeRows.filter((r) => r.left_at !== null && r.left_at >= cutoff).map(toChangeEntry);
    if (joined.length === 0 && left.length === 0) continue;
    workingGroupsWithChanges += 1;

    const recipients: Array<{ userId: string; email: string; name: string; role: string }> = [];
    if (wg.chair)
      recipients.push({ userId: wg.chair.userId, email: wg.chair.email, name: wg.chair.name, role: "chair" });
    if (wg.viceChair && wg.viceChair.userId !== wg.chair?.userId) {
      recipients.push({
        userId: wg.viceChair.userId,
        email: wg.viceChair.email,
        name: wg.viceChair.name,
        role: "vice chair",
      });
    }

    for (const recipient of recipients) {
      const preferences = await getUserNotificationPreferences(db, recipient.userId);
      if (!preferences.wgChairMembershipDigest) continue;

      const outboxId = await queueEmail(db, {
        templateKey: "wg-chair-membership-digest",
        recipientUserId: recipient.userId,
        recipientEmail: recipient.email,
        messageType: "transactional",
        subject: `${wg.name} — weekly membership update`,
        data: {
          workingGroupName: wg.name,
          recipientName: recipient.name,
          recipientRole: recipient.role,
          joined,
          left,
        },
      });
      await processOutboxByIdBackground(db, env, outboxId);
      emailsSent += 1;
    }
  }

  return { workingGroupsWithChanges, emailsSent };
}
