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
export async function loadLiveRoomCommandRead(
  db: DatabaseLike,
  rooms: Env["LIVE_SESSION_ROOMS"],
  room: { eventId: string; session: { occurrenceId: string } },
  participants: readonly LiveRoomParticipant[],
  authors: readonly LiveRoomParticipant[],
  erasureCandidates: readonly string[],
): Promise<LiveRoomCommandRead> {
  const {
    eventId,
    session: { occurrenceId },
  } = room;
  const reads = [];
  for (let offset = 0; offset < participants.length; offset += 512)
    reads.push(prepareLiveRoomParticipants(db, participants.slice(offset, offset + 512), eventId, occurrenceId, rooms));
  const statements = reads.flatMap((read) => read.statements);
  const authorIndex = statements.length;
  const authorIds = [...new Set(authors.flatMap((author) => (author.userId ? [author.userId] : [])))];
  if (authorIds.length) statements.push(prepareLiveAuthorStampCandidates(db, eventId, authorIds));
  const erasureIndex = statements.length;
  statements.push(prepareAnonymizedLiveParticipantIds(db, erasureCandidates));
  const loaded = await db.batch(statements);
  const snapshot: LiveRoomCommandRead = {
    active: true,
    eventId,
    occurrenceId,
    participants: new Map(),
    authors: new Map(),
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
  const stampRows = authorIds.length ? batchRows<StampRow>(loaded[authorIndex]) : [];
  for (const author of authors) {
    const resolved = snapshot.participants.get(liveParticipantReadKey(author));
    if (!resolved?.ok) continue;
    const viewer = resolved.participant;
    const row = stampRows.find(
      (row) => row.user_id === viewer.userId && row.selected_identity_id === (viewer.actingIdentityId ?? null),
    );
    if (row) {
      const stamp = decodeLiveAuthorStamp(row, viewer);
      snapshot.authors.set(liveParticipantReadKey(author), stamp);
      snapshot.authors.set(liveParticipantReadKey(viewer), stamp);
    }
  }
  return snapshot;
}

/** Fresh command scopes remain available for reads outside an admitted room connection. */
export async function withLiveRoomCommandRead<T>(
  db: DatabaseLike,
  rooms: Env["LIVE_SESSION_ROOMS"],
  room: { eventId: string; session: { occurrenceId: string } },
  participants: readonly LiveRoomParticipant[],
  author: LiveRoomParticipant | null,
  erasureCandidates: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  const read = await loadLiveRoomCommandRead(db, rooms, room, participants, author ? [author] : [], erasureCandidates);
  return runWithLiveRoomCommandRead(read, work);
}
