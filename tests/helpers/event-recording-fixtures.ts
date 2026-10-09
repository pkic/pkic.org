import type { DatabaseLike } from "../../functions/_lib/types";
import { nowIso } from "../../functions/_lib/utils/time";

/** Explicit synthetic event/provider linkage shared by recording integration fixtures. */
export async function seedRecordingMeeting(
  db: DatabaseLike,
  input: {
    eventId: string;
    userId: string;
    meetingLinkId?: string;
    providerMeetingId?: string;
    providerAccountId?: string;
    providerAppId?: string;
    nativeSeriesId?: string;
    nativeOccurrenceId?: string;
    now?: string;
  },
) {
  const meetingLinkId = input.meetingLinkId ?? crypto.randomUUID();
  const providerMeetingId = input.providerMeetingId ?? crypto.randomUUID();
  const providerAccountId = input.providerAccountId ?? "0123456789abcdef0123456789abcdef";
  const providerAppId = input.providerAppId ?? "synthetic-app";
  await db
    .prepare(
      `INSERT INTO event_recording_meetings
      (id,event_id,native_series_id,native_occurrence_id,provider_type,provider_account_id,
       provider_app_id,provider_meeting_id,title,linked_by_user_id,linked_at)
      VALUES(?,?,?,?,'realtimekit',?,?,?,'Recorded meeting',?,?)`,
    )
    .bind(
      meetingLinkId,
      input.eventId,
      input.nativeSeriesId ?? null,
      input.nativeOccurrenceId ?? null,
      providerAccountId,
      providerAppId,
      providerMeetingId,
      input.userId,
      input.now ?? nowIso(),
    )
    .run();
  return { meetingLinkId, providerMeetingId, providerAccountId, providerAppId };
}
