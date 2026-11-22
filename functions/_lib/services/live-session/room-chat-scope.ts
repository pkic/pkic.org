import { liveLocationChatWindow } from "../../../../assets/shared/live-location-chat";
import { liveRoomWindow } from "../../../../assets/shared/live-session-policy";
import type { LiveLocationChatStore } from "./location-chat-store";
import { liveRoomName } from "./room-admission";
import type { LiveRoomStore } from "./room-store";

/** What a room object's chat is kept by: a session's room, or a location's chat for one event day. */
export interface LiveRoomChatScope {
  eventId: string;
  /** The room object's name, which also keys its authors' handles. */
  name: string;
  /** When the session, or the day's last session there, ends: the chat's retention runs from it. */
  endAt: string;
  /** When the chat closes on schedule, as epoch milliseconds; its messages may not be erased before. */
  closesAt: number;
}

export function liveRoomChatScope(store: LiveRoomStore, location: LiveLocationChatStore): LiveRoomChatScope | null {
  const room = store.session();
  if (room)
    return {
      eventId: room.eventId,
      name: liveRoomName(room.eventId, room.session.occurrenceId),
      endAt: room.session.endAt,
      closesAt: liveRoomWindow(room.session.startAt, room.session.endAt).closesAt,
    };
  const state = location.state();
  if (!state) return null;
  const window = liveLocationChatWindow(state.scope.sessions)!;
  return {
    eventId: state.eventId,
    name: location.name(state),
    endAt: location.endsAt(state),
    closesAt: window.closesAt,
  };
}
