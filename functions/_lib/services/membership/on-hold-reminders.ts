import { all } from "../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { isAppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { getMembershipSettings } from "../membership-settings";
import {
  ON_HOLD_SUBTYPE_EMAIL_TEMPLATES,
  executePreparedApplicationStageTransition,
  prepareApplicationStageTransition,
  type ApplicationStageTransitionSubject,
} from "./applications/transition";
import { buildApplicationClosedNoResponseEmail, buildOnHoldReminderEmail } from "./notifications";

export const ON_HOLD_CLOSURE_DUE_QUERY = `
  SELECT id, applicant_email, applicant_name, stage, stage_entered_at, transition_revision,
         on_hold_reminder_sent_at
  FROM member_applications INDEXED BY idx_member_applications_on_hold_closure_due
  WHERE stage = 'on_hold' AND stage_entered_at <= ?
  ORDER BY stage_entered_at ASC, id ASC
  LIMIT ?`;

export const ON_HOLD_REMINDER_DUE_QUERY = `
  SELECT id, applicant_email, applicant_name, stage, stage_entered_at, transition_revision, on_hold_subtype
  FROM member_applications INDEXED BY idx_member_applications_on_hold_reminder_due
  WHERE stage = 'on_hold'
    AND stage_entered_at > ?
    AND stage_entered_at <= ?
    AND on_hold_reminder_sent_at IS NULL
    AND on_hold_subtype IS NOT NULL
  ORDER BY stage_entered_at ASC, id ASC
  LIMIT ?`;

interface OnHoldReminderCandidate {
  id: string;
  applicant_email: string;
  applicant_name: string;
  stage: "on_hold";
  stage_entered_at: string;
  transition_revision: number;
  on_hold_subtype: string;
}

type OnHoldWorkItem =
  | { kind: "closure"; application: ApplicationStageTransitionSubject }
  | { kind: "reminder"; application: OnHoldReminderCandidate };

const ON_HOLD_SELECTION_STATEMENTS = 3;
const ON_HOLD_MAX_ACTION_STATEMENTS = 6;
const ON_HOLD_REMINDER_STATEMENTS = 4;

function selectFairWork(
  closures: ApplicationStageTransitionSubject[],
  reminders: OnHoldReminderCandidate[],
  limit: number,
): OnHoldWorkItem[] {
  if (limit === 1) {
    const reminderLaneFirst = Math.floor(Date.now() / (15 * 60_000)) % 2 === 1;
    if (reminderLaneFirst) {
      if (reminders[0]) return [{ kind: "reminder", application: reminders[0] }];
      if (closures[0]) return [{ kind: "closure", application: closures[0] }];
    } else {
      if (closures[0]) return [{ kind: "closure", application: closures[0] }];
      if (reminders[0]) return [{ kind: "reminder", application: reminders[0] }];
    }
    return [];
  }
  const closureTarget = Math.ceil(limit / 2);
  const reminderTarget = Math.floor(limit / 2);
  const selectedClosures = closures.slice(0, closureTarget);
  const selectedReminders = reminders.slice(0, reminderTarget);
  let remaining = limit - selectedClosures.length - selectedReminders.length;
  let closureIndex = selectedClosures.length;
  let reminderIndex = selectedReminders.length;

  while (remaining > 0 && (closureIndex < closures.length || reminderIndex < reminders.length)) {
    if (closureIndex < closures.length) {
      selectedClosures.push(closures[closureIndex++]);
      remaining -= 1;
    }
    if (remaining > 0 && reminderIndex < reminders.length) {
      selectedReminders.push(reminders[reminderIndex++]);
      remaining -= 1;
    }
  }

  const work: OnHoldWorkItem[] = [];
  const laneLength = Math.max(selectedClosures.length, selectedReminders.length);
  for (let index = 0; index < laneLength; index += 1) {
    if (selectedClosures[index]) work.push({ kind: "closure", application: selectedClosures[index] });
    if (selectedReminders[index]) work.push({ kind: "reminder", application: selectedReminders[index] });
  }
  return work;
}

async function claimOnHoldReminder(
  db: DatabaseLike,
  application: OnHoldReminderCandidate,
  deadlineDays: number,
  deadlineCutoff: string,
  reminderCutoff: string,
): Promise<boolean> {
  const templateKey =
    ON_HOLD_SUBTYPE_EMAIL_TEMPLATES[application.on_hold_subtype as keyof typeof ON_HOLD_SUBTYPE_EMAIL_TEMPLATES];
  if (!templateKey) return false;

  const now = nowIso();
  const operationKey = `application-on-hold-reminder:${application.id}:${application.transition_revision}`;
  const reminderEmail = prepareQueueEmailStatement(
    db,
    {
      ...buildOnHoldReminderEmail({
        templateKey,
        recipientEmail: application.applicant_email,
        applicantName: application.applicant_name,
        deadlineDays,
      }),
      outboxId: (await sha256Hex(operationKey)).slice(0, 32),
      idempotencyKey: operationKey,
    },
    now,
  );
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE member_applications
           SET on_hold_reminder_sent_at = ?, updated_at = ?
           WHERE id = ?
             AND stage = 'on_hold'
             AND transition_revision = ?
             AND on_hold_subtype = ?
             AND stage_entered_at > ?
             AND stage_entered_at <= ?
             AND on_hold_reminder_sent_at IS NULL`,
        )
        .bind(
          now,
          now,
          application.id,
          application.transition_revision,
          application.on_hold_subtype,
          deadlineCutoff,
          reminderCutoff,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "system",
        null,
        "application_on_hold_reminder_queued",
        "member_application",
        application.id,
        {
          onHoldSubtype: application.on_hold_subtype,
          stageEnteredAt: application.stage_entered_at,
          transitionRevision: application.transition_revision,
          templateKey,
          recipientEmail: application.applicant_email,
        },
        now,
      ),
      reminderEmail.statement,
      db
        .prepare(
          `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
           VALUES (?, ?, 'on_hold', 'on_hold', NULL, 'Hold reminder sent', ?)`,
        )
        .bind(uuid(), application.id, now),
    ]);
    return true;
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) return false;
    throw error;
  }
}

export async function runOnHoldReminders(
  db: DatabaseLike,
  _env: Env,
  limit = 100,
  d1QueryBudget?: D1QueryBudget,
): Promise<{ remindersSent: number; autoClosed: number }> {
  const emptyResult = { remindersSent: 0, autoClosed: 0 };
  const requestedLimit = Math.max(0, Math.min(500, Math.floor(limit)));
  if (requestedLimit === 0) return emptyResult;
  const budgetBoundedLimit = d1QueryBudget
    ? Math.floor(
        Math.max(0, d1QueryBudget.remainingQueries() - ON_HOLD_SELECTION_STATEMENTS) / ON_HOLD_MAX_ACTION_STATEMENTS,
      )
    : requestedLimit;
  const boundedLimit = Math.min(requestedLimit, budgetBoundedLimit);
  if (boundedLimit < 1) return emptyResult;

  const settings = await getMembershipSettings(db);
  const deadlineDays = settings.on_hold_response_deadline_days;
  const nowMs = Date.now();
  const deadlineCutoff = new Date(nowMs - deadlineDays * 86_400_000).toISOString();
  const reminderCutoff = new Date(nowMs - (deadlineDays - 3) * 86_400_000).toISOString();
  const closures = await all<ApplicationStageTransitionSubject>(db, ON_HOLD_CLOSURE_DUE_QUERY, [
    deadlineCutoff,
    boundedLimit,
  ]);
  const reminders = settings.auto_reminder_on_holds
    ? await all<OnHoldReminderCandidate>(db, ON_HOLD_REMINDER_DUE_QUERY, [deadlineCutoff, reminderCutoff, boundedLimit])
    : [];
  const work = settings.auto_reminder_on_holds
    ? selectFairWork(closures, reminders, boundedLimit)
    : closures.slice(0, boundedLimit).map((application) => ({ kind: "closure" as const, application }));
  let remindersSent = 0;
  let autoClosed = 0;

  for (const item of work) {
    if (item.kind === "reminder") {
      if (!hasD1QueryCapacity(d1QueryBudget, ON_HOLD_REMINDER_STATEMENTS)) break;
      if (await claimOnHoldReminder(db, item.application, deadlineDays, deadlineCutoff, reminderCutoff)) {
        remindersSent += 1;
      }
      continue;
    }

    const prepared = prepareApplicationStageTransition(db, item.application, {
      applicationId: item.application.id,
      toStage: "withdrawn",
      actor: null,
      note: "Auto-closed — no response within the on-hold deadline",
      email: buildApplicationClosedNoResponseEmail({
        recipientEmail: item.application.applicant_email,
        applicantName: item.application.applicant_name,
        deadlineDays,
      }),
    });
    // The transition executor performs one diagnostic read after a
    // failed CAS batch. Reserve that query before starting the atomic write.
    if (!hasD1QueryCapacity(d1QueryBudget, prepared.statements.length + 1)) break;
    try {
      await executePreparedApplicationStageTransition(db, item.application, prepared);
      autoClosed += 1;
    } catch (error) {
      if (!isAppError(error) || error.code !== "STAGE_TRANSITION_CONFLICT") throw error;
    }
  }

  return { remindersSent, autoClosed };
}
