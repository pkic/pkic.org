/**
 * Membership workflow settings — a single configurable row
 * (consolidated migration 0035 seeds `id = 'default'`), read by the consultation/EC
 * batch jobs (membership-scheduled-jobs.ts) and the system portal.
 */
import type { MembershipSettingsUpdate } from "../../../assets/shared/schemas/membership-settings";
import { first } from "../db/queries";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import { adminDatabaseUserId } from "../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import type { AuthAdmin, DatabaseLike } from "../types";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";

export interface MembershipSettingsRow {
  id: string;
  consultation_window_days: number;
  ec_review_window_days: number;
  on_hold_response_deadline_days: number;
  consultation_email_recipients: string;
  ec_email_recipients: string;
  cc_applicant_emails: string;
  auto_reminder_on_holds: number;
  revision: number;
  updated_at: string;
  updated_by_user_id: string | null;
}

const MEMBERSHIP_SETTINGS_COLUMNS =
  "id, consultation_window_days, ec_review_window_days, on_hold_response_deadline_days, " +
  "consultation_email_recipients, ec_email_recipients, cc_applicant_emails, auto_reminder_on_holds, " +
  "revision, updated_at, updated_by_user_id";

export async function getMembershipSettings(db: DatabaseLike): Promise<MembershipSettingsRow> {
  const row = await first<MembershipSettingsRow>(
    db,
    `SELECT ${MEMBERSHIP_SETTINGS_COLUMNS} FROM membership_settings WHERE id = 'default'`,
  );
  if (!row) {
    throw new AppError(
      500,
      "MEMBERSHIP_SETTINGS_MISSING",
      "membership_settings row is missing — expected consolidated migration 0035 to have seeded it",
    );
  }
  return row;
}

export type MembershipSettingsUpdateInput = Omit<MembershipSettingsUpdate, "expectedRevision"> & {
  expectedRevision?: number;
};

export async function updateMembershipSettings(
  db: DatabaseLike,
  updates: MembershipSettingsUpdateInput,
  actor: AuthAdmin | null,
): Promise<MembershipSettingsRow> {
  const current = await getMembershipSettings(db);
  const expectedRevision = updates.expectedRevision ?? current.revision;
  if (current.revision !== expectedRevision) {
    throw new AppError(409, "MEMBERSHIP_CONFIGURATION_CHANGED", "Membership settings changed; reload and retry");
  }
  const now = nowIso();
  const actorUserId = actor ? adminDatabaseUserId(actor) : null;

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
    revision: current.revision + 1,
    updated_at: now,
    updated_by_user_id: actorUserId,
  };

  const update = db
    .prepare(
      `UPDATE membership_settings
       SET consultation_window_days = ?, ec_review_window_days = ?, on_hold_response_deadline_days = ?,
           consultation_email_recipients = ?, ec_email_recipients = ?, cc_applicant_emails = ?,
           auto_reminder_on_holds = ?, revision = revision + 1, updated_at = ?, updated_by_user_id = ?
       WHERE id = 'default' AND revision = ?`,
    )
    .bind(
      next.consultation_window_days,
      next.ec_review_window_days,
      next.on_hold_response_deadline_days,
      next.consultation_email_recipients,
      next.ec_email_recipients,
      next.cc_applicant_emails,
      next.auto_reminder_on_holds,
      now,
      actorUserId,
      expectedRevision,
    );
  const { expectedRevision: _expectedRevision, ...changes } = updates;

  if (!actor) {
    const result = await update.run();
    if (result.meta?.changes !== 1) {
      throw new AppError(409, "MEMBERSHIP_CONFIGURATION_CHANGED", "Membership settings changed; reload and retry");
    }
    return next;
  }

  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      update,
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "membership_settings_updated",
        "membership_settings",
        "default",
        changes,
        now,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBERSHIP_CONFIGURATION_AUTHORIZATION_CHANGED",
        "Membership-management permission changed while the settings were being saved",
      );
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "MEMBERSHIP_CONFIGURATION_CHANGED", "Membership settings changed; reload and retry");
    }
    throw error;
  }

  return next;
}
