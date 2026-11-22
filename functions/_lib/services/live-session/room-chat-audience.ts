import type { LiveRoomParticipant } from "./room-admission";

/** Moderators see the location's full conversation. Other viewers see their sessions and shared break chat. */
export function chatOccurrenceIds(viewer: LiveRoomParticipant): readonly string[] | null {
  return viewer.role === "operator" ? null : (viewer.locationOccurrenceIds ?? []);
}

export function seesChatOccurrence(viewer: LiveRoomParticipant, occurrenceId: string | null): boolean {
  return (
    occurrenceId === null || viewer.role === "operator" || viewer.locationOccurrenceIds?.includes(occurrenceId) === true
  );
}

export function chatAudienceKey(viewer: LiveRoomParticipant): string {
  return JSON.stringify([viewer.role, chatOccurrenceIds(viewer)]);
}

/** Trusted message ID expression. A message without a session belongs to the shared location chat. */
export function chatOccurrenceFilter(messageIdSql: string, occurrenceIds: readonly string[] | null) {
  return occurrenceIds === null
    ? { sql: "1", bindings: [] }
    : {
        sql: `NOT EXISTS(SELECT 1 FROM room_chat_sessions audience
          WHERE audience.message_id=${messageIdSql} AND audience.occurrence_id NOT IN(SELECT value FROM json_each(?)))`,
        bindings: [JSON.stringify(occurrenceIds)],
      };
}
