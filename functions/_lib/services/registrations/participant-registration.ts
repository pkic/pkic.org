import { run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike } from "../../types";

export interface ParticipantRegistrationLike {
  event_id: string;
  user_id: string;
  status: string;
  attendance_type: string;
  source_type: string;
  source_ref: string | null;
}

export function participantStatusForRegistration(status: string): "active" | "inactive" | "invited" | "waitlisted" {
  if (status === "cancelled") {
    return "inactive";
  }
  if (status === "waitlisted") {
    return "waitlisted";
  }
  if (status === "pending_email_confirmation") {
    return "invited";
  }
  return "active";
}

export async function upsertAttendeeParticipant(
  db: DatabaseLike,
  registration: ParticipantRegistrationLike,
): Promise<void> {
  const participantStatus = participantStatusForRegistration(registration.status);
  const now = nowIso();

  await run(
    db,
    `INSERT INTO event_participants (
      id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at
    ) VALUES (?, ?, ?, 'attendee', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, user_id, role, subrole)
    DO UPDATE SET status = excluded.status, source_type = excluded.source_type, source_ref = excluded.source_ref,
                  updated_at = excluded.updated_at`,
    [
      uuid(),
      registration.event_id,
      registration.user_id,
      registration.attendance_type,
      participantStatus,
      registration.source_type,
      registration.source_ref,
      now,
      now,
    ],
  );
}
