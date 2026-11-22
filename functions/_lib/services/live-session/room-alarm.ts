import { LIVE_TICKER_REFRESH_MS } from "./room-ticker";
import { liveRoomPurgeAt } from "../../../../assets/shared/live-session-policy";
import { copyLiveRoomToD1 } from "./room-durable-copy";
import type { DatabaseLike } from "../../types";
import type { LiveRoomProgram } from "./room-program";
import type { LiveRoomStore } from "./room-store";
import type { LiveRoomAccessLease } from "./room-access-lease";
import type { LiveRoomPreparedQuestions } from "./room-prepared-questions";

const GRAPHICS_DUE = "live-room-graphics-refresh-at";

/**
 * One alarm owns access refresh, prepared-question releases, durable-copy
 * retries, graphics cadence, and final room erasure. A physical room's
 * program pointer lives in its own object (`program:` names), which never
 * holds a session, so its alarm has no questions to release.
 */
export async function runLiveRoomAlarm(input: {
  ctx: DurableObjectState;
  program: LiveRoomProgram;
  store: LiveRoomStore;
  db: DatabaseLike;
  access: LiveRoomAccessLease;
  refreshGraphics: () => Promise<void>;
  preparedQuestions: LiveRoomPreparedQuestions;
  copyDue: () => number;
  purge: () => Promise<void>;
}): Promise<void> {
  const { ctx, program, store, db, access } = input;
  if (await program.exists()) return program.alarm();
  const room = store.session();
  if (!room) return;
  const purgeAt = liveRoomPurgeAt(room.session.endAt);
  // Due questions come into the list first, so this alarm's copy already carries them.
  if (Date.now() < purgeAt) await input.preparedQuestions.releaseDue(room.session);
  // Capture the pending copy before refresh can erase room-local rows. The
  // atomic D1 erasure guard preserves redacted history without restoring PII.
  const pending = store.pendingCopy();
  await access.refresh();
  if (pending) {
    try {
      await copyLiveRoomToD1(db, pending);
      store.markCopied(pending);
    } catch (error) {
      console.error("Live room durable copy failed", error);
    }
  }
  if (Date.now() >= purgeAt && !store.hasPendingCopy()) return input.purge();
  const hasSockets = ctx.getWebSockets().some((socket) => socket.readyState === WebSocket.OPEN);
  let graphicsAt = (await ctx.storage.get<number>(GRAPHICS_DUE)) ?? 0;
  if (hasSockets && Date.now() < purgeAt && graphicsAt <= Date.now()) {
    await input.refreshGraphics();
    graphicsAt = Date.now() + LIVE_TICKER_REFRESH_MS;
    await ctx.storage.put(GRAPHICS_DUE, graphicsAt);
  }
  const next = [purgeAt];
  if (store.hasPendingCopy()) next.push(input.copyDue());
  const accessAt = access.nextRefreshAt();
  if (accessAt !== null) next.push(accessAt);
  const releaseAt = input.preparedQuestions.nextReleaseAt();
  if (releaseAt !== null && releaseAt < purgeAt) next.push(releaseAt);
  if (hasSockets && Date.now() < purgeAt) next.push(graphicsAt);
  await ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...next)));
}
