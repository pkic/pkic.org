import { LIVE_TICKER_REFRESH_MS } from "./room-ticker";
import { liveRoomPurgeAt } from "../../../../assets/shared/live-session-policy";
import { copyLiveRoomToD1 } from "./room-durable-copy";
import type { DatabaseLike } from "../../types";
import type { LiveRoomProgram } from "./room-program";
import type { LiveRoomStore } from "./room-store";
import type { LiveRoomAccessLease } from "./room-access-lease";

const GRAPHICS_DUE = "live-room-graphics-refresh-at";

/** One alarm owns access refresh, durable-copy retries, graphics cadence, and final room erasure. */
export async function runLiveRoomAlarm(input: {
  ctx: DurableObjectState;
  program: LiveRoomProgram;
  store: LiveRoomStore;
  db: DatabaseLike;
  access: LiveRoomAccessLease;
  refreshGraphics: () => Promise<void>;
  copyDue: () => number;
  purge: () => Promise<void>;
}): Promise<void> {
  const { ctx, program, store, db, access } = input;
  if (await program.exists()) return program.alarm();
  const room = store.session();
  if (!room) return;
  // Capture the pending copy before refresh can erase room-local rows. The
  // atomic D1 erasure guard preserves redacted history without restoring PII.
  const pending = store.pendingCopy();
  await access.refresh();
  if (pending) {
    await copyLiveRoomToD1(db, pending);
    store.markCopied(pending);
  }
  const purgeAt = liveRoomPurgeAt(room.session.endAt);
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
  if (hasSockets && Date.now() < purgeAt) next.push(graphicsAt);
  await ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...next)));
}
