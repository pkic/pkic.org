import { AsyncLocalStorage } from "node:async_hooks";
import type { AppError } from "../../errors";
import type { LiveAuthorStamp } from "../../../../assets/shared/schemas/live-session-author";
import type { LiveRoomParticipant } from "./room-admission";

export type LiveParticipantReadResult =
  | { ok: true; participant: LiveRoomParticipant; expiresAt: number }
  | { ok: false; error: AppError };
/** What a room's access is checked against: one session, or a location's chat for one event day. */
export type LiveRoomAccessScope =
  | { eventId: string; session: { occurrenceId: string } }
  | { eventId: string; location: { roomId: string; day: string } };

/** One key per scope, so a read made for one room is never taken for another's. */
export function liveRoomAccessScopeKey(scope: LiveRoomAccessScope): string {
  return "session" in scope
    ? `session:${scope.session.occurrenceId}`
    : `location:${scope.location.roomId}:${scope.location.day}`;
}

export interface LiveRoomCommandRead {
  active: boolean;
  eventId: string;
  /** The access scope the read was made for, as `liveRoomAccessScopeKey` names it. */
  scopeKey: string;
  participants: Map<string, LiveParticipantReadResult>;
  erasureCandidates: Set<string>;
  erased: Set<string>;
  authors: Map<string, LiveAuthorStamp>;
  /** Which erasure candidates an organizer blocked for the whole event. */
  eventBlocked?: Set<string>;
}

const commandRead = new AsyncLocalStorage<LiveRoomCommandRead>();

/** Auth inputs only: subscriptions can change while a read is pending and retain their own fencing. */
export function liveParticipantReadKey(participant: LiveRoomParticipant): string {
  return JSON.stringify([
    participant.role,
    participant.studio === true,
    participant.userId,
    participant.sessionClaims,
    participant.overlayRoomId,
    participant.overlayExpiresAt,
    participant.overlayOutput,
  ]);
}

export function currentLiveRoomCommandRead(): LiveRoomCommandRead | undefined {
  const current = commandRead.getStore();
  return current?.active ? current : undefined;
}

/** End this execution scope with its work; later callbacks obtain their own current lease scope or fresh read. */
export async function runWithLiveRoomCommandRead<T>(read: LiveRoomCommandRead, work: () => Promise<T>): Promise<T> {
  return commandRead.run(read, async () => {
    try {
      return await work();
    } finally {
      read.active = false;
    }
  });
}
