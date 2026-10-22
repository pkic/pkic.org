import type { LiveRoomClientMessage } from "../../../../assets/shared/schemas/live-session-room";
import { LIVE_PROGRAM_SOCKET_TAG } from "./room-program";
import { batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import type { LiveRoomParticipant } from "./room-admission";
import { prepareLiveRoomParticipants } from "./room-access";
import { prepareLiveAuthorStampCandidates, decodeLiveAuthorStamp, type StampRow } from "./room-author-stamp";
import { prepareAnonymizedLiveParticipantIds } from "./room-erasure";
import {
  liveParticipantReadKey,
  runWithLiveRoomCommandRead,
  type LiveRoomCommandRead,
} from "./room-command-read-scope";

/** Compose existing read models once for this command, including its protected broadcast audience. */
export async function withLiveRoomCommandRead<T>(
  db: DatabaseLike,
  rooms: Env["LIVE_SESSION_ROOMS"],
  room: { eventId: string; session: { occurrenceId: string } },
  participants: readonly LiveRoomParticipant[],
  author: LiveRoomParticipant | null,
  erasureCandidates: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  const {
    eventId,
    session: { occurrenceId },
  } = room;
  const reads = [];
  for (let offset = 0; offset < participants.length; offset += 512)
    reads.push(prepareLiveRoomParticipants(db, participants.slice(offset, offset + 512), eventId, occurrenceId, rooms));
  const statements = reads.flatMap((read) => read.statements);
  const authorIndex = statements.length;
  if (author?.userId) statements.push(prepareLiveAuthorStampCandidates(db, eventId, author.userId));
  const erasureIndex = statements.length;
  statements.push(prepareAnonymizedLiveParticipantIds(db, erasureCandidates));
  const loaded = await db.batch(statements);
  const snapshot: LiveRoomCommandRead = {
    active: true,
    eventId,
    occurrenceId,
    participants: new Map(),
    erasureCandidates: new Set(erasureCandidates),
    erased: new Set(batchRows<{ id: string }>(loaded[erasureIndex]).map((row) => row.id)),
  };
  let offset = 0;
  for (let index = 0; index < reads.length; index++) {
    const read = reads[index];
    const slice = participants.slice(index * 512, (index + 1) * 512);
    try {
      const results = await read.decode(loaded.slice(offset, offset + read.statements.length));
      for (let i = 0; i < slice.length; i++) {
        snapshot.participants.set(liveParticipantReadKey(slice[i]), results[i]);
        // The sender's refreshed attachment is also used by protected broadcasts.
        const result = results[i];
        if (result.ok) snapshot.participants.set(liveParticipantReadKey(result.participant), result);
      }
    } catch (error) {
      if (!(error instanceof AppError) || error.status < 400 || error.status >= 500) throw error;
      for (const participant of slice)
        snapshot.participants.set(liveParticipantReadKey(participant), { ok: false, error });
    }
    offset += read.statements.length;
  }
  if (author?.userId) {
    const resolved = snapshot.participants.get(liveParticipantReadKey(author));
    if (resolved?.ok) {
      const viewer = resolved.participant;
      const identityId = viewer.actingIdentityId ?? null;
      const row = batchRows<StampRow>(loaded[authorIndex]).find((row) => row.selected_identity_id === identityId);
      if (row)
        snapshot.author = {
          userId: author.userId,
          identityId,
          role: viewer.role,
          stamp: decodeLiveAuthorStamp(row, viewer),
        };
    }
  }
  return runWithLiveRoomCommandRead(snapshot, work);
}

// These commands reply only to their sender. Their deferred aggregate broadcasts
// obtain a new audience read when the timer fires, after this command scope ends.
const SENDER_ONLY_COMMANDS = new Set<LiveRoomClientMessage["type"]>([
  "chat.history",
  "author.lookup",
  "question.answers.watch",
  "chat.react",
  "reaction.send",
  "poll.vote",
]);

/** Collect only the command's immediate protected audience before its canonical read batch. */
export function withLiveRoomSocketCommandRead<T>(
  input: {
    env: Pick<Env, "DB" | "LIVE_SESSION_ROOMS">;
    ctx: DurableObjectState;
    room: { eventId: string; session: { occurrenceId: string } };
    viewer: LiveRoomParticipant;
    message: LiveRoomClientMessage;
    erasureCandidates: string[];
  },
  work: () => Promise<T>,
): Promise<T> {
  const { env, ctx, room, viewer, message } = input;
  const participants = SENDER_ONLY_COMMANDS.has(message.type)
    ? [viewer]
    : ctx
        .getWebSockets()
        .filter(
          (socket) => socket.readyState === WebSocket.OPEN && !ctx.getTags(socket).includes(LIVE_PROGRAM_SOCKET_TAG),
        )
        .map((socket) => socket.deserializeAttachment() as LiveRoomParticipant);
  const erasureCandidates = new Set(input.erasureCandidates);
  if (viewer.userId) erasureCandidates.add(viewer.userId);
  const writesAuthor = ["chat.send", "question.ask", "question.answer"].includes(message.type);
  return withLiveRoomCommandRead(
    env.DB,
    env.LIVE_SESSION_ROOMS,
    room,
    participants,
    writesAuthor ? viewer : null,
    [...erasureCandidates],
    work,
  );
}
