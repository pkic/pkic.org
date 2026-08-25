import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export interface MeetingGuest {
  guestId: string;
  seriesId: string;
  occurrenceId: string | null;
  normalizedEmail: string;
  name: string;
  affiliation: string | null;
  expiresAt: string;
  invitationVersion: number;
}

export interface MeetingGuestRow {
  id: string;
  series_id: string;
  occurrence_id: string | null;
  normalized_email: string;
  name: string;
  affiliation: string | null;
  expires_at: string;
  revoked_at: string | null;
  invitation_version: number;
}

export function toMeetingGuest(row: MeetingGuestRow): MeetingGuest {
  return {
    guestId: row.id,
    seriesId: row.series_id,
    occurrenceId: row.occurrence_id,
    normalizedEmail: row.normalized_email,
    name: row.name,
    affiliation: row.affiliation,
    expiresAt: row.expires_at,
    invitationVersion: row.invitation_version,
  };
}

export async function findMeetingGuest(db: DatabaseLike, guestId: string): Promise<MeetingGuestRow | null> {
  return first<MeetingGuestRow>(
    db,
    `SELECT id, series_id, occurrence_id, normalized_email, name, affiliation,
            expires_at, revoked_at, invitation_version
       FROM event_occurrence_guests
      WHERE id = ?`,
    [guestId],
  );
}

export function requireLiveMeetingGuest(row: MeetingGuestRow | null): MeetingGuestRow {
  if (!row) {
    throw new AppError(404, "MEETING_GUEST_INVITATION_INVALID", "Meeting invitation is invalid");
  }
  if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(410, "MEETING_GUEST_INVITATION_INACTIVE", "Meeting invitation is no longer active");
  }
  return row;
}
