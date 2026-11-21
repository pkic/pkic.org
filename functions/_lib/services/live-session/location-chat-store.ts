import { liveLocationChatStamp } from "../../../../assets/shared/live-location-chat";
import {
  liveLocationChatScopeSchema,
  type LiveLocationChatScope,
} from "../../../../assets/shared/schemas/live-location-chat";
import {
  DEFAULT_LIVE_ROOM_OPENING,
  liveRoomOpeningSchema,
  type LiveRoomOpening,
} from "../../../../assets/shared/schemas/live-room-opening";
import type { LiveLocationChatAdmission } from "./location-chat-admission";
import { liveLocationChatName } from "./room-admission";
import type { LiveRoomAccessScope } from "./room-command-read-scope";
import type { LiveRoomSql } from "./room-sql";
import type { LiveStaffActionRow } from "./room-store";

/** A location's chat as one room object holds it: its day, the session loaded there, and its opening. */
export interface LiveLocationChatState {
  eventId: string;
  scope: LiveLocationChatScope;
  speakerUserIds: string[];
  loadedOccurrenceId: string | null;
  opening: LiveRoomOpening;
}

/** Chat counts and moderation acts not yet copied to D1, each count under the session it was sent during. */
export interface LiveLocationChatPendingCopy {
  eventId: string;
  roomId: string;
  day: string;
  throughSeq: number;
  totals: { occurrence_id: string; messages: number; people: number }[];
  staffActions: LiveStaffActionRow[];
}

type Row = {
  event_id: string;
  record_json: string;
  loaded_occurrence_id: string | null;
  opening: string;
};

/**
 * The location-chat state of a room object named for a location's day. A session's room never writes it, so
 * its absence is what tells the two apart; reading it never creates storage in an erased room.
 */
export class LiveLocationChatStore {
  private cached: LiveLocationChatState | null | undefined;

  constructor(private readonly sql: LiveRoomSql) {}

  state(): LiveLocationChatState | null {
    if (this.cached !== undefined) return this.cached;
    if (!this.sql.holdsData()) return null;
    const [row] = this.sql.rows<Row>(
      "SELECT event_id, record_json, loaded_occurrence_id, opening FROM location_chat WHERE id = 1",
    );
    if (!row) return (this.cached = null);
    const record = JSON.parse(row.record_json) as { scope: unknown; speakerUserIds: string[] };
    this.cached = {
      eventId: row.event_id,
      scope: liveLocationChatScopeSchema.parse(record.scope),
      speakerUserIds: record.speakerUserIds,
      loadedOccurrenceId: row.loaded_occurrence_id,
      opening: liveRoomOpeningSchema.catch(DEFAULT_LIVE_ROOM_OPENING).parse(row.opening),
    };
    return this.cached;
  }

  /** Saves the day as the latest admission read it; the loaded session and the opening stay. Answers whether it is new. */
  save(admission: Pick<LiveLocationChatAdmission, "eventId" | "scope" | "speakerUserIds">): boolean {
    const created = this.state() === null;
    this.sql.exec(
      `INSERT INTO location_chat(id, event_id, room_id, day, record_json) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json`,
      admission.eventId,
      admission.scope.roomId,
      admission.scope.day,
      JSON.stringify({ scope: admission.scope, speakerUserIds: admission.speakerUserIds }),
    );
    this.cached = undefined;
    return created;
  }

  loaded(occurrenceId: string | null): void {
    this.sql.exec("UPDATE location_chat SET loaded_occurrence_id = ? WHERE id = 1", occurrenceId);
    this.cached = undefined;
  }

  setOpening(opening: LiveRoomOpening): void {
    this.sql.exec("UPDATE location_chat SET opening = ? WHERE id = 1", opening);
    this.cached = undefined;
  }

  /** The room object's name, which also keys its authors' handles. */
  name(state: LiveLocationChatState): string {
    return liveLocationChatName(state.eventId, state.scope.roomId, state.scope.day);
  }

  /** The session a message sent at `now` is dated by: the studio's, else the agenda's, else none. */
  stamp(now: number): string | null {
    const state = this.state();
    return state ? liveLocationChatStamp(now, state.scope.sessions, state.loadedOccurrenceId) : null;
  }

  accessScope(): LiveRoomAccessScope | null {
    const state = this.state();
    return state ? { eventId: state.eventId, location: { roomId: state.scope.roomId, day: state.scope.day } } : null;
  }

  /** When the day's last session ends, which starts the chat's retention. */
  endsAt(state: LiveLocationChatState): string {
    return state.scope.sessions.reduce((last, session) => (session.endAt > last ? session.endAt : last), "");
  }

  pendingCopy(): LiveLocationChatPendingCopy | null {
    const state = this.state();
    if (!state) return null;
    const [{ change_seq: throughSeq, copied_seq: copiedSeq }] = this.sql.rows<{
      change_seq: number;
      copied_seq: number;
    }>("SELECT change_seq, copied_seq FROM copy_state WHERE id = 1");
    const staffActions = this.sql.rows<LiveStaffActionRow>(
      "SELECT seq, actor_user_id, action, details_json, occurred_at FROM staff_actions ORDER BY seq",
    );
    if (throughSeq === copiedSeq && !staffActions.length) return null;
    return {
      eventId: state.eventId,
      roomId: state.scope.roomId,
      day: state.scope.day,
      throughSeq,
      totals: this.sql.rows(
        `SELECT totals.occurrence_id, totals.messages,
           (SELECT COUNT(*) FROM room_chat_session_senders senders WHERE senders.occurrence_id = totals.occurrence_id) AS people
         FROM room_chat_session_totals totals WHERE totals.change_seq > ?`,
        copiedSeq,
      ),
      staffActions,
    };
  }

  markCopied(copy: LiveLocationChatPendingCopy): void {
    this.sql.exec("UPDATE copy_state SET copied_seq = MAX(copied_seq, ?) WHERE id = 1", copy.throughSeq);
    const lastAction = copy.staffActions.at(-1);
    if (lastAction) this.sql.exec("DELETE FROM staff_actions WHERE seq <= ?", lastAction.seq);
  }

  /** Forgets the cached state after the room's storage was erased. */
  erased(): void {
    this.cached = undefined;
  }
}
