import { AsyncLocalStorage } from "node:async_hooks";
import type { AppError } from "../../errors";
import type { LiveAuthorStamp } from "../../../../assets/shared/schemas/live-session-author";
import type { LiveRoomParticipant } from "./room-admission";

export type LiveParticipantReadResult =
  | { ok: true; participant: LiveRoomParticipant; expiresAt: number }
  | { ok: false; error: AppError };
export interface LiveRoomCommandRead {
  active: boolean;
  eventId: string;
  occurrenceId: string;
  participants: Map<string, LiveParticipantReadResult>;
  erasureCandidates: Set<string>;
  erased: Set<string>;
  authors: Map<string, LiveAuthorStamp>;
}

const commandRead = new AsyncLocalStorage<LiveRoomCommandRead>();

/** Auth inputs only: subscriptions can change while a read is pending and retain their own fencing. */
export function liveParticipantReadKey(participant: LiveRoomParticipant): string {
  return JSON.stringify([
    participant.role,
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
