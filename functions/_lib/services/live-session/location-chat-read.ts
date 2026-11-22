import {
  liveLocationChatDays,
  type LiveLocationChatDay,
  type LiveLocationChatSession,
} from "../../../../assets/shared/live-location-chat";
import { agendaOccurrenceSchema } from "../../../../assets/shared/schemas/event-agenda";
import { canonicalSessionCredits } from "../../../../assets/shared/session-public-credits";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

/** What a location's chat knows about its day: the sessions it dates messages by, and who speaks in them. */
export interface LiveLocationChatRecord {
  eventId: string;
  eventName: string;
  timeZone: string;
  roomId: string;
  day: string;
  sessions: (LiveLocationChatSession & { title: string })[];
  /** Accounts credited on each session in this location. */
  speakersByOccurrence: ReadonlyMap<string, readonly string[]>;
}

export type LiveLocationChatRow = { payload_json: string; timezone: string; event_name: string };

function unavailable() {
  return new AppError(404, "LIVE_LOCATION_CHAT_NOT_FOUND", "This location has no sessions on the approved agenda.");
}

/**
 * The location's scheduled, non-break sessions on the approved agenda, in one bounded read: a location holds a
 * few dozen sessions over an event. `decode` keeps those of one event day, or of the day a viewer joins at `now`.
 */
export function prepareLiveLocationChatRead(db: DatabaseLike, eventId: string, roomId: string) {
  const statement = db
    .prepare(
      `SELECT approved.payload_json,event.timezone,event.name AS event_name FROM event_agenda_state state
       JOIN event_agenda_published_occurrences approved ON approved.event_id=state.event_id AND approved.revision=state.published_revision
       JOIN events event ON event.id=state.event_id
       WHERE state.event_id=? AND json_extract(approved.payload_json,'$.kind')<>'break'
         AND (json_extract(approved.payload_json,'$.roomId')=?
           OR EXISTS(SELECT 1 FROM json_each(approved.payload_json,'$.additionalRoomIds') extra WHERE extra.value=?))`,
    )
    .bind(eventId, roomId, roomId);
  return {
    statement,
    decode(
      rows: readonly LiveLocationChatRow[],
      day: string | ((days: LiveLocationChatDay[]) => LiveLocationChatDay | null),
    ): LiveLocationChatRecord {
      const occurrences = rows.flatMap((row) => {
        const parsed = agendaOccurrenceSchema.safeParse(JSON.parse(row.payload_json));
        const occurrence = parsed.success ? parsed.data : null;
        return occurrence && !occurrence.placeholder && occurrence.startAt && occurrence.endAt
          ? [{ occurrence, startAt: occurrence.startAt, endAt: occurrence.endAt }]
          : [];
      });
      const row = rows[0];
      if (!row || !occurrences.length) throw unavailable();
      const days = liveLocationChatDays(
        occurrences.map(({ occurrence, startAt, endAt }) => ({ occurrenceId: occurrence.id, startAt, endAt })),
        row.timezone,
      );
      const chosen = typeof day === "string" ? day : (day(days)?.day ?? null);
      const sessions = days.find((entry) => entry.day === chosen)?.sessions;
      if (!chosen || !sessions) throw unavailable();
      const byId = new Map(occurrences.map((entry) => [entry.occurrence.id, entry.occurrence]));
      return {
        eventId,
        eventName: row.event_name,
        timeZone: row.timezone,
        roomId,
        day: chosen,
        sessions: sessions.map((session) => ({ ...session, title: byId.get(session.occurrenceId)!.title })),
        speakersByOccurrence: new Map(
          sessions.map(({ occurrenceId }) => [
            occurrenceId,
            canonicalSessionCredits(byId.get(occurrenceId)!).flatMap((credit) =>
              "userId" in credit ? [credit.userId] : [],
            ),
          ]),
        ),
      };
    },
  };
}
