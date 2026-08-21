/**
 * Membership workflow settings — a single configurable row
 * (consolidated migration 0035 seeds `id = 'default'`), read by the consultation/EC
 * batch jobs (membership-scheduled-jobs.ts) and the admin settings screen.
 */
import { first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export interface MembershipSettingsRow {
  id: string;
  consultation_window_days: number;
  ec_review_window_days: number;
  on_hold_response_deadline_days: number;
  consultation_email_recipients: string;
  ec_email_recipients: string;
  cc_applicant_emails: string;
  auto_reminder_on_holds: number;
  forum_vote_min_endorsers: number;
  updated_at: string;
  updated_by_user_id: string | null;
}

export async function getMembershipSettings(db: DatabaseLike): Promise<MembershipSettingsRow> {
  const row = await first<MembershipSettingsRow>(db, `SELECT * FROM membership_settings WHERE id = 'default'`);
  if (!row) {
    throw new AppError(
      500,
      "MEMBERSHIP_SETTINGS_MISSING",
      "membership_settings row is missing — expected consolidated migration 0035 to have seeded it",
    );
  }
  return row;
}

export interface MembershipSettingsUpdateInput {
  consultationWindowDays?: number;
  ecReviewWindowDays?: number;
  onHoldResponseDeadlineDays?: number;
  consultationEmailRecipients?: string;
  ecEmailRecipients?: string;
  ccApplicantEmails?: string;
  autoReminderOnHolds?: boolean;
  forumVoteMinEndorsers?: number;
}

export async function updateMembershipSettings(
  db: DatabaseLike,
  updates: MembershipSettingsUpdateInput,
  actorUserId: string | null,
): Promise<MembershipSettingsRow> {
  const current = await getMembershipSettings(db);
  const now = nowIso();

  const next: MembershipSettingsRow = {
    ...current,
    consultation_window_days: updates.consultationWindowDays ?? current.consultation_window_days,
    ec_review_window_days: updates.ecReviewWindowDays ?? current.ec_review_window_days,
    on_hold_response_deadline_days: updates.onHoldResponseDeadlineDays ?? current.on_hold_response_deadline_days,
    consultation_email_recipients: updates.consultationEmailRecipients ?? current.consultation_email_recipients,
    ec_email_recipients: updates.ecEmailRecipients ?? current.ec_email_recipients,
    cc_applicant_emails: updates.ccApplicantEmails ?? current.cc_applicant_emails,
    auto_reminder_on_holds:
      updates.autoReminderOnHolds === undefined ? current.auto_reminder_on_holds : updates.autoReminderOnHolds ? 1 : 0,
    forum_vote_min_endorsers: updates.forumVoteMinEndorsers ?? current.forum_vote_min_endorsers,
    updated_at: now,
    updated_by_user_id: actorUserId,
  };

  await run(
    db,
    `UPDATE membership_settings
     SET consultation_window_days = ?, ec_review_window_days = ?, on_hold_response_deadline_days = ?,
         consultation_email_recipients = ?, ec_email_recipients = ?, cc_applicant_emails = ?,
         auto_reminder_on_holds = ?, forum_vote_min_endorsers = ?, updated_at = ?, updated_by_user_id = ?
     WHERE id = 'default'`,
    [
      next.consultation_window_days,
      next.ec_review_window_days,
      next.on_hold_response_deadline_days,
      next.consultation_email_recipients,
      next.ec_email_recipients,
      next.cc_applicant_emails,
      next.auto_reminder_on_holds,
      next.forum_vote_min_endorsers,
      now,
      actorUserId,
    ],
  );

  return next;
}
