import {
  RSVP_FAR_ACTION_DELAY_HOURS,
  RSVP_FAR_EVENT_LEAD_HOURS,
  RSVP_MID_ACTION_DELAY_HOURS,
  RSVP_NEAR_ACTION_DELAY_HOURS,
  RSVP_NEAR_EVENT_LEAD_HOURS,
  RSVP_WARNING_DELAY_HOURS,
} from "../../../../assets/shared/constants/rsvp-enforcement";
import { prepareQueueEmailStatement } from "../../email/outbox";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { queuedCapabilityToken } from "../capability-links";
import { registrationManagePageUrl } from "../frontend-links";
import { HAS_NEWER_ACCEPT_SQL, type RsvpEnforcementCandidate } from "./candidates";
import { rsvpOutboxId } from "./command-utils";

function manageUrl(candidate: RsvpEnforcementCandidate, env: Env): string {
  if (!env.APP_BASE_URL) return "";
  return registrationManagePageUrl(
    env.APP_BASE_URL,
    {
      slug: candidate.event_slug,
      base_path: candidate.event_base_path,
      starts_at: candidate.event_starts_at,
      settings_json: candidate.event_settings_json,
    },
    queuedCapabilityToken("registration_manage", candidate.registration_id),
  );
}

function actionDueAt(candidate: RsvpEnforcementCandidate, warningSentAt: string): string {
  const warningTime = Date.parse(warningSentAt);
  const dayStart = candidate.day_starts_at ? Date.parse(candidate.day_starts_at) : Number.NaN;
  const leadHours = Number.isFinite(dayStart) ? (dayStart - warningTime) / 3_600_000 : 0;
  const delayHours =
    leadHours > RSVP_FAR_EVENT_LEAD_HOURS
      ? RSVP_FAR_ACTION_DELAY_HOURS
      : leadHours > RSVP_NEAR_EVENT_LEAD_HOURS
        ? RSVP_MID_ACTION_DELAY_HOURS
        : RSVP_NEAR_ACTION_DELAY_HOURS;
  return new Date(warningTime + delayHours * 3_600_000).toISOString();
}

export async function ignoreRsvpCandidate(
  db: DatabaseLike,
  candidate: RsvpEnforcementCandidate,
  reason: "ignored_newer_accept" | "ignored_unresolved_day" | "ignored_no_longer_in_person",
): Promise<boolean> {
  let extraPredicate = "1 = 1";
  if (reason === "ignored_newer_accept") extraPredicate = `EXISTS (${HAS_NEWER_ACCEPT_SQL})`;
  if (reason === "ignored_unresolved_day") {
    extraPredicate = `(
      event_day_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM event_days ed
        WHERE ed.id = calendar_rsvp_events.event_day_id AND ed.starts_at IS NOT NULL
      )
    )`;
  }
  if (reason === "ignored_no_longer_in_person") {
    extraPredicate = `event_day_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM registration_day_attendance rda
      WHERE rda.registration_id = calendar_rsvp_events.registration_id
        AND rda.event_day_id = calendar_rsvp_events.event_day_id
        AND rda.attendance_type = 'in_person'
    )`;
  }
  const at = nowIso();
  const bindings =
    reason === "ignored_newer_accept" ? [at, reason, at, candidate.id, candidate.id] : [at, reason, at, candidate.id];
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE calendar_rsvp_events
           SET action_executed_at = ?, action_taken = ?, updated_at = ?
           WHERE id = ? AND action_executed_at IS NULL AND ${extraPredicate}`,
        )
        .bind(...bindings),
      prepareAuditLogAfterOneChange(
        db,
        "system",
        null,
        "rsvp_candidate_ignored",
        "calendar_rsvp_event",
        candidate.id,
        {
          registration_id: candidate.registration_id,
          event_day_id: candidate.event_day_id,
          reason,
        },
        at,
      ),
    ]);
    return true;
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) return false;
    throw error;
  }
}

/** Records an unauthenticated email-delivery signal without changing attendance. */
export async function recordRsvpDeliveryBounce(
  db: DatabaseLike,
  candidate: RsvpEnforcementCandidate,
): Promise<boolean> {
  const at = nowIso();
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE calendar_rsvp_events
           SET action_executed_at = ?, action_taken = 'recorded_delivery_bounce', updated_at = ?
           WHERE id = ? AND response_status = 'bounced' AND action_executed_at IS NULL`,
        )
        .bind(at, at, candidate.id),
      prepareAuditLogAfterOneChange(
        db,
        "system",
        null,
        "rsvp_delivery_bounce_recorded",
        "calendar_rsvp_event",
        candidate.id,
        {
          registration_id: candidate.registration_id,
          event_day_id: candidate.event_day_id,
          attendance_changed: false,
        },
        at,
      ),
    ]);
    return true;
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) return false;
    throw error;
  }
}

export async function sendRsvpWarning(
  db: DatabaseLike,
  env: Env,
  candidate: RsvpEnforcementCandidate,
): Promise<boolean> {
  const at = nowIso();
  const dueAt = actionDueAt(candidate, at);
  const url = manageUrl(candidate, env);
  const queued = prepareQueueEmailStatement(
    db,
    {
      outboxId: await rsvpOutboxId("warning", candidate.id),
      idempotencyKey: `calendar_rsvp:warning:${candidate.id}`,
      templateKey: "rsvp_warning",
      eventId: candidate.event_id,
      recipientUserId: candidate.user_id,
      recipientEmail: candidate.user_email,
      capabilityLinkValues: [url],
      data: {
        firstName: candidate.first_name ?? "",
        event_name: candidate.event_name,
        event_day: candidate.day_label ?? candidate.day_date ?? "",
        manage_url: url,
      },
      messageType: "transactional",
    },
    at,
  );
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE calendar_rsvp_events
         SET warning_sent_at = ?, action_due_at = ?, updated_at = ?
         WHERE id = ?
           AND action_executed_at IS NULL
           AND warning_sent_at IS NULL
           AND event_day_id IS NOT NULL
           AND response_status IN ('declined', 'tentative')
           AND julianday(received_at) <= julianday('now', '-' || ? || ' hours')
           AND NOT EXISTS (${HAS_NEWER_ACCEPT_SQL})`,
      )
      .bind(at, dueAt, at, candidate.id, RSVP_WARNING_DELAY_HOURS, candidate.id),
    prepareAuditLogAfterOneChange(
      db,
      "system",
      null,
      "rsvp_warning_sent",
      "calendar_rsvp_event",
      candidate.id,
      { registration_id: candidate.registration_id, event_day_id: candidate.event_day_id },
      at,
    ),
    queued.statement,
  ];
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) return false;
    throw error;
  }
}
