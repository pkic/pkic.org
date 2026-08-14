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
import { all, run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { getConfig } from "../config";
import { queueEmail, processOutboxByIdBackground } from "../email/outbox";
import type { AdminSponsorshipRow } from "./sponsorship";
import type { DatabaseLike, Env } from "../types";

const REMINDER_60_NOTE = "Renewal reminder sent (60 days)";
const REMINDER_30_NOTE = "Renewal reminder sent (30 days)";
const ONE_DAY_MS = 86_400_000;

function daysUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / ONE_DAY_MS;
}

async function alreadySent(db: DatabaseLike, sponsorshipId: string, note: string): Promise<boolean> {
  const rows = await all<{ id: string }>(
    db,
    `SELECT id FROM sponsorship_events WHERE sponsorship_id = ? AND note = ? LIMIT 1`,
    [sponsorshipId, note],
  );
  return rows.length > 0;
}

async function recordReminderSent(db: DatabaseLike, sponsorshipId: string, stage: string, note: string): Promise<void> {
  await run(
    db,
    `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    [uuid(), sponsorshipId, stage, stage, note, nowIso()],
  );
}

async function sponsorName(row: AdminSponsorshipRow): Promise<string> {
  return row.organization_name ?? row.non_member_name ?? row.contact_name ?? "Sponsor";
}

async function activeSponsorshipsWithRenewalDate(db: DatabaseLike): Promise<AdminSponsorshipRow[]> {
  return all<AdminSponsorshipRow>(
    db,
    `SELECT sp.id, sp.sponsor_type, sp.organization_id, o.name AS organization_name,
            sp.non_member_name, sp.non_member_website, sp.contact_name, sp.contact_email,
            sp.event_id, e.name AS event_name, sp.tier, sp.pipeline_stage,
            sp.start_date, sp.renewal_date, sp.assigned_to_user_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS assigned_to_name,
            sp.notes, sp.created_at, sp.updated_at
     FROM sponsorships sp
     LEFT JOIN organizations o ON o.id = sp.organization_id
     LEFT JOIN events e ON e.id = sp.event_id
     LEFT JOIN users u ON u.id = sp.assigned_to_user_id
     WHERE sp.pipeline_stage = 'active' AND sp.renewal_date IS NOT NULL`,
  );
}

export interface SponsorshipDueWorkResult {
  reminders60Sent: number;
  reminders30Sent: number;
  autoLapsed: number;
}

export async function runSponsorshipDueWork(db: DatabaseLike, env: Env): Promise<SponsorshipDueWorkResult> {
  const config = getConfig(env);
  const sponsorships = await activeSponsorshipsWithRenewalDate(db);
  let reminders60Sent = 0;
  let reminders30Sent = 0;
  let autoLapsed = 0;

  for (const sponsorship of sponsorships) {
    if (!sponsorship.renewal_date) continue;
    const daysLeft = daysUntil(sponsorship.renewal_date);

    let assignedEmail: string | null = null;
    if (sponsorship.assigned_to_user_id) {
      const assignedRows = await all<{ email: string }>(db, `SELECT email FROM users WHERE id = ?`, [
        sponsorship.assigned_to_user_id,
      ]);
      assignedEmail = assignedRows[0]?.email ?? null;
    }

    const templateData = {
      organizationName: await sponsorName(sponsorship),
      tier: sponsorship.tier,
      renewalDate: sponsorship.renewal_date,
      adminUrl: `${config.appBaseUrl}/admin/#/sponsorships/${sponsorship.id}`,
    };

    // Auto-lapse fires regardless of whether staff is assigned — only the
    // notification email (like the 60/30-day reminders) depends on
    // assigned_to_user_id being set.
    if (daysLeft <= 0) {
      const now = nowIso();
      const statements = [
        db
          .prepare(`UPDATE sponsorships SET pipeline_stage = 'lapsed', updated_at = ? WHERE id = ?`)
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
      await db.batch(statements);

      if (assignedEmail) {
        const outboxId = await queueEmail(db, {
          templateKey: "sponsorship-lapsed-staff",
          recipientEmail: assignedEmail,
          messageType: "transactional",
          subject: `Sponsorship lapsed: ${templateData.organizationName}`,
          data: templateData,
        });
        await processOutboxByIdBackground(db, env, outboxId);
      }
      autoLapsed++;
      continue;
    }

    if (!assignedEmail) continue;

    if (daysLeft <= 60 && daysLeft > 30 && !(await alreadySent(db, sponsorship.id, REMINDER_60_NOTE))) {
      const outboxId = await queueEmail(db, {
        templateKey: "sponsorship-renewal-reminder-60",
        recipientEmail: assignedEmail,
        messageType: "transactional",
        subject: `Sponsorship renewal due in 60 days: ${templateData.organizationName}`,
        data: templateData,
      });
      await processOutboxByIdBackground(db, env, outboxId);
      await recordReminderSent(db, sponsorship.id, sponsorship.pipeline_stage, REMINDER_60_NOTE);
      reminders60Sent++;
      continue;
    }

    if (daysLeft <= 30 && !(await alreadySent(db, sponsorship.id, REMINDER_30_NOTE))) {
      const outboxId = await queueEmail(db, {
        templateKey: "sponsorship-renewal-reminder-30",
        recipientEmail: assignedEmail,
        messageType: "transactional",
        subject: `Sponsorship renewal due in 30 days: ${templateData.organizationName}`,
        data: templateData,
      });
      await processOutboxByIdBackground(db, env, outboxId);
      await recordReminderSent(db, sponsorship.id, sponsorship.pipeline_stage, REMINDER_30_NOTE);
      reminders30Sent++;
    }
  }

  return { reminders60Sent, reminders30Sent, autoLapsed };
}
