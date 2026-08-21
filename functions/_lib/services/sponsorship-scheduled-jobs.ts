/**
 * Sponsorship renewal reminders & auto-lapse (Renewal
 * Reminders), folded into the existing 15-minute due-work cron
 * (functions/router.ts) as a sibling call, same as
 * membership-scheduled-jobs.ts's runMembershipDueWork — not woven into
 * scheduled-due-work.ts's own multi-pass budgeted loop, for the same
 * "keep this phase's additions isolated" reason documented there.
 *
 * "Already reminded" dedup mirrors runOnHoldReminders: rather than adding
 * new sponsorships columns to track per-threshold reminder state, each send
 * is recorded as a sponsorship_events row with a distinctive note, and a
 * lookup against that table before sending is the guard against re-sending
 * on every 15-minute tick for the same threshold.
 */
import { all, first } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { getConfig } from "../config";
import { prepareQueueEmailStatement } from "../email/outbox";
import { prepareAuditLog } from "./audit";
import type { DatabaseLike, Env, StatementLike } from "../types";

const REMINDER_60_NOTE = "Renewal reminder sent (60 days)";
const REMINDER_30_NOTE = "Renewal reminder sent (30 days)";
const ONE_DAY_MS = 86_400_000;

/**
 * Narrower than the admin pipeline's `AdminSponsorshipRow` — this due-work
 * pass only ever renders a reminder/lapse email, so it selects (and joins)
 * only the columns it requires, including `assigned_to_email` directly
 * from the same `users` join instead of a per-row follow-up lookup (PR #1
 * review §9.1's N+1 finding — the join was already there, just not
 * selecting the one column this file actually needs).
 */
interface SponsorshipDueWorkRow {
  id: string;
  sponsor_type: string;
  organization_id: string | null;
  organization_name: string | null;
  non_member_name: string | null;
  contact_name: string | null;
  tier: string | null;
  pipeline_stage: string;
  renewal_date: string | null;
  assigned_to_email: string | null;
  reminder_60_applied: number;
  reminder_30_applied: number;
  auto_lapse_applied: number;
}

function daysUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / ONE_DAY_MS;
}

const EFFECT_REMINDER_60 = "renewal-reminder-60";
const EFFECT_REMINDER_30 = "renewal-reminder-30";
const EFFECT_AUTO_LAPSE = "auto-lapse";

async function applyAutomationEffect(
  db: DatabaseLike,
  sponsorshipId: string,
  effectKey: string,
  statements: StatementLike[],
  appliedAt: string,
): Promise<boolean> {
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO sponsorship_automation_effects (sponsorship_id, effect_key, created_at)
           VALUES (?, ?, ?)`,
        )
        .bind(sponsorshipId, effectKey, appliedAt),
      ...statements,
    ]);
    return true;
  } catch (error) {
    const existing = await first<{ applied: number }>(
      db,
      `SELECT 1 AS applied
       FROM sponsorship_automation_effects
       WHERE sponsorship_id = ? AND effect_key = ?
       LIMIT 1`,
      [sponsorshipId, effectKey],
    );
    if (existing) return false;
    throw error;
  }
}

function sponsorName(row: SponsorshipDueWorkRow): string {
  return row.organization_name ?? row.non_member_name ?? row.contact_name ?? "Sponsor";
}

async function activeSponsorshipsWithRenewalDate(db: DatabaseLike, limit: number): Promise<SponsorshipDueWorkRow[]> {
  // Indexed due predicate + stable ORDER BY + LIMIT (PR #1 review §9.1) —
  // was an unbounded scan of every active-with-renewal-date sponsorship.
  return all<SponsorshipDueWorkRow>(
    db,
    `SELECT sp.id, sp.sponsor_type, sp.organization_id, o.name AS organization_name,
            sp.non_member_name, sp.contact_name, sp.tier, sp.pipeline_stage,
            sp.renewal_date, u.email AS assigned_to_email,
            EXISTS(
              SELECT 1 FROM sponsorship_automation_effects ae
              WHERE ae.sponsorship_id = sp.id AND ae.effect_key = '${EFFECT_REMINDER_60}'
            ) AS reminder_60_applied,
            EXISTS(
              SELECT 1 FROM sponsorship_automation_effects ae
              WHERE ae.sponsorship_id = sp.id AND ae.effect_key = '${EFFECT_REMINDER_30}'
            ) AS reminder_30_applied,
            EXISTS(
              SELECT 1 FROM sponsorship_automation_effects ae
              WHERE ae.sponsorship_id = sp.id AND ae.effect_key = '${EFFECT_AUTO_LAPSE}'
            ) AS auto_lapse_applied
     FROM sponsorships sp
     LEFT JOIN organizations o ON o.id = sp.organization_id
     LEFT JOIN users u ON u.id = sp.assigned_to_user_id
     WHERE sp.pipeline_stage = 'active' AND sp.renewal_date IS NOT NULL
     ORDER BY sp.renewal_date ASC
     LIMIT ?`,
    [limit],
  );
}

export interface SponsorshipDueWorkResult {
  reminders60Sent: number;
  reminders30Sent: number;
  autoLapsed: number;
}

export async function runSponsorshipDueWork(
  db: DatabaseLike,
  env: Env,
  limit = 100,
): Promise<SponsorshipDueWorkResult> {
  const config = getConfig(env);
  const sponsorships = await activeSponsorshipsWithRenewalDate(db, limit);
  let reminders60Sent = 0;
  let reminders30Sent = 0;
  let autoLapsed = 0;

  for (const sponsorship of sponsorships) {
    if (!sponsorship.renewal_date) continue;
    const daysLeft = daysUntil(sponsorship.renewal_date);
    // assigned_to_email comes from the same LEFT JOIN the bulk query above
    // already performs — no per-row follow-up lookup (PR #1 review §9.1's
    // N+1 finding).
    const assignedEmail = sponsorship.assigned_to_email;

    const templateData = {
      organizationName: sponsorName(sponsorship),
      tier: sponsorship.tier,
      renewalDate: sponsorship.renewal_date,
      adminUrl: `${config.appBaseUrl}/admin/#/sponsorships/${sponsorship.id}`,
    };

    // Auto-lapse fires regardless of whether staff is assigned — only the
    // notification email (like the 60/30-day reminders) depends on
    // assigned_to_user_id being set.
    if (daysLeft <= 0) {
      const now = nowIso();
      const statements: StatementLike[] = [
        db
          .prepare(
            `UPDATE sponsorships
             SET pipeline_stage = 'lapsed', updated_at = ?
             WHERE id = ? AND pipeline_stage = 'active'`,
          )
          .bind(now, sponsorship.id),
        db
          .prepare(
            `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
             VALUES (?, ?, ?, 'lapsed', NULL, 'Auto-lapsed — renewal date passed with no renewal action', ?)`,
          )
          .bind(uuid(), sponsorship.id, sponsorship.pipeline_stage, now),
      ];
      if (sponsorship.sponsor_type === "consortium" && sponsorship.organization_id) {
        statements.push(
          db
            .prepare(`UPDATE organizations SET sponsor_tier = NULL, sponsor_start_date = NULL WHERE id = ?`)
            .bind(sponsorship.organization_id),
        );
      }
      if (assignedEmail) {
        statements.push(
          prepareQueueEmailStatement(
            db,
            {
              templateKey: "sponsorship-lapsed-staff",
              recipientEmail: assignedEmail,
              messageType: "transactional",
              subject: `Sponsorship lapsed: ${templateData.organizationName}`,
              data: templateData,
            },
            now,
          ).statement,
        );
      }
      statements.push(
        prepareAuditLog(
          db,
          "system",
          null,
          "sponsorship_auto_lapsed",
          "sponsorship",
          sponsorship.id,
          {
            renewalDate: sponsorship.renewal_date,
          },
          now,
        ),
      );
      if (!sponsorship.auto_lapse_applied) {
        const applied = await applyAutomationEffect(db, sponsorship.id, EFFECT_AUTO_LAPSE, statements, now);
        if (applied) autoLapsed++;
      }
      continue;
    }

    if (!assignedEmail) continue;

    if (daysLeft <= 60 && daysLeft > 30 && !sponsorship.reminder_60_applied) {
      const now = nowIso();
      const email = prepareQueueEmailStatement(
        db,
        {
          templateKey: "sponsorship-renewal-reminder-60",
          recipientEmail: assignedEmail,
          messageType: "transactional",
          subject: `Sponsorship renewal due in 60 days: ${templateData.organizationName}`,
          data: templateData,
        },
        now,
      );
      const applied = await applyAutomationEffect(
        db,
        sponsorship.id,
        EFFECT_REMINDER_60,
        [
          email.statement,
          db
            .prepare(
              `INSERT INTO sponsorship_events
                 (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
               VALUES (?, ?, ?, ?, NULL, ?, ?)`,
            )
            .bind(
              uuid(),
              sponsorship.id,
              sponsorship.pipeline_stage,
              sponsorship.pipeline_stage,
              REMINDER_60_NOTE,
              now,
            ),
        ],
        now,
      );
      if (applied) reminders60Sent++;
      continue;
    }

    if (daysLeft <= 30 && !sponsorship.reminder_30_applied) {
      const now = nowIso();
      const email = prepareQueueEmailStatement(
        db,
        {
          templateKey: "sponsorship-renewal-reminder-30",
          recipientEmail: assignedEmail,
          messageType: "transactional",
          subject: `Sponsorship renewal due in 30 days: ${templateData.organizationName}`,
          data: templateData,
        },
        now,
      );
      const applied = await applyAutomationEffect(
        db,
        sponsorship.id,
        EFFECT_REMINDER_30,
        [
          email.statement,
          db
            .prepare(
              `INSERT INTO sponsorship_events
                 (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
               VALUES (?, ?, ?, ?, NULL, ?, ?)`,
            )
            .bind(
              uuid(),
              sponsorship.id,
              sponsorship.pipeline_stage,
              sponsorship.pipeline_stage,
              REMINDER_30_NOTE,
              now,
            ),
        ],
        now,
      );
      if (applied) reminders30Sent++;
    }
  }

  return { reminders60Sent, reminders30Sent, autoLapsed };
}
