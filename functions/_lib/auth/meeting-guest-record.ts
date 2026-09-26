import { first } from "../db/queries";
import { AppError } from "../errors";
import { effectiveMeetingGuestInviteExpirySql } from "../invite-validity";
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

export interface MeetingGuestCapabilityRow extends MeetingGuestRow {
  invitation_secret: string;
}

export const EFFECTIVE_MEETING_GUEST_FROM = `FROM event_occurrence_guests guest
  JOIN event_series series ON series.id = guest.series_id
  JOIN events event ON event.id = series.event_id
  LEFT JOIN event_occurrences guest_occurrence
    ON guest_occurrence.id = guest.occurrence_id AND guest_occurrence.series_id = guest.series_id`;

export function effectiveMeetingGuestColumns(includeSecret = false): string {
  return `guest.id, guest.series_id, guest.occurrence_id, guest.normalized_email,
    guest.name, guest.affiliation,
    ${effectiveMeetingGuestInviteExpirySql()} AS expires_at,
    guest.revoked_at, guest.invitation_version${includeSecret ? ", guest.invitation_secret" : ""}`;
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
    `SELECT ${effectiveMeetingGuestColumns()}
       ${EFFECTIVE_MEETING_GUEST_FROM}
      WHERE guest.id = ?`,
    [guestId],
  );
}

/** Exact guest generation used to revalidate a capability before challenge creation. */
export async function findMeetingGuestCapabilitySnapshot(
  db: DatabaseLike,
  guestId: string,
): Promise<MeetingGuestCapabilityRow | null> {
  return first<MeetingGuestCapabilityRow>(
    db,
    `SELECT ${effectiveMeetingGuestColumns(true)}
       ${EFFECTIVE_MEETING_GUEST_FROM}
      WHERE guest.id = ?`,
    [guestId],
  );
}

export function requireLiveMeetingGuest<T extends MeetingGuestRow>(row: T | null): T {
  if (!row) {
    throw new AppError(404, "MEETING_GUEST_INVITATION_INVALID", "Meeting invitation is invalid");
  }
  if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(410, "MEETING_GUEST_INVITATION_INACTIVE", "Meeting invitation is no longer active");
  }
  return row;
}
