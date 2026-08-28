import { prepareQueueEmailStatement } from "../../email/outbox";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { resolveAttendanceOptions } from "../event-days";
import { HAS_NEWER_ACCEPT_SQL, type RsvpEnforcementCandidate } from "./candidates";
import { rsvpOutboxId } from "./command-utils";

function fallbackAttendance(candidate: RsvpEnforcementCandidate): string | null {
  const options = resolveAttendanceOptions({
    attendance_options_json: candidate.attendance_options_json,
    in_person_capacity: candidate.in_person_capacity,
  });
  if (options.some((option) => option.value === "on_demand")) return "on_demand";
  if (options.some((option) => option.value === "virtual")) return "virtual";
  return null;
}

export async function buildRsvpDayAction(
  db: DatabaseLike,
  candidate: RsvpEnforcementCandidate,
): Promise<{
  statements: StatementLike[];
  actionTaken: string;
  fallback: string | null;
}> {
  const at = nowIso();
  const fallback = fallbackAttendance(candidate);
  const actionTaken = fallback ? `day_downgraded_${fallback}` : "day_removed";
  const toType = fallback ?? "not_attending";
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE calendar_rsvp_events
         SET action_executed_at = ?, action_taken = ?, updated_at = ?
         WHERE id = ?
           AND action_executed_at IS NULL
           AND response_status IN ('declined', 'tentative')
           AND action_due_at IS NOT NULL
           AND action_due_at <= ?
           AND event_day_id IS NOT NULL
           AND NOT EXISTS (${HAS_NEWER_ACCEPT_SQL})
           AND EXISTS (
             SELECT 1 FROM registration_day_attendance rda
             WHERE rda.registration_id = calendar_rsvp_events.registration_id
               AND rda.event_day_id = calendar_rsvp_events.event_day_id
               AND rda.attendance_type = 'in_person'
           )`,
      )
      .bind(at, actionTaken, at, candidate.id, at, candidate.id),
    prepareAuditLogAfterOneChange(
      db,
      "system",
      null,
      actionTaken,
      "calendar_rsvp_event",
      candidate.id,
      {
        registration_id: candidate.registration_id,
        event_day_id: candidate.event_day_id,
        response_status: candidate.response_status,
        attendance_type: { from: "in_person", to: toType },
      },
      at,
    ),
  ];
  statements.push(
    fallback
      ? db
          .prepare(
            `UPDATE registration_day_attendance
             SET attendance_type = ?, updated_at = ?
             WHERE registration_id = ? AND event_day_id = ? AND attendance_type = 'in_person'`,
          )
          .bind(fallback, at, candidate.registration_id, candidate.event_day_id)
      : db
          .prepare(
            `DELETE FROM registration_day_attendance
             WHERE registration_id = ? AND event_day_id = ? AND attendance_type = 'in_person'`,
          )
          .bind(candidate.registration_id, candidate.event_day_id),
    db
      .prepare(
        `INSERT INTO registration_attendance_history
           (id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at)
         VALUES (?, ?, ?, 'in_person', ?, 'rsvp_enforcer', ?)`,
      )
      .bind(uuid(), candidate.registration_id, candidate.event_day_id, toType, at),
    db
      .prepare(
        `UPDATE event_day_waitlist_entries
         SET status = 'removed', offer_expires_at = NULL, reason_code = 'rsvp_declined', updated_at = ?
         WHERE registration_id = ? AND event_day_id = ?
           AND status IN ('waiting', 'offered', 'accepted')`,
      )
      .bind(at, candidate.registration_id, candidate.event_day_id),
    prepareQueueEmailStatement(db, {
      outboxId: await rsvpOutboxId("action", candidate.id),
      idempotencyKey: `calendar_rsvp:action:${candidate.id}`,
      templateKey: "rsvp_downgraded",
      eventId: candidate.event_id,
      recipientUserId: candidate.user_id,
      recipientEmail: candidate.user_email,
      data: {
        firstName: candidate.first_name ?? "",
        event_name: candidate.event_name,
        event_day: candidate.day_label ?? candidate.day_date ?? "",
        action_taken: actionTaken,
        new_attendance_type: toType,
      },
      messageType: "transactional",
    }).statement,
  );
  return { statements, actionTaken, fallback };
}

export async function commitRsvpDayAction(db: DatabaseLike, statements: StatementLike[]): Promise<boolean> {
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) return false;
    throw error;
  }
}
