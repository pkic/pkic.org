import { buildAttendeePromotionSource } from "./promotion-attendee-source";
import type { DatabaseLike } from "../../types";
import { preparePromotionSourceRead } from "./promotion-source-read";
import { buildSpeakerPromotionSource } from "./promotion-speaker-source";
export async function getPromotionKit(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  actorId: string,
  origin: string,
) {
  const read = preparePromotionSourceRead(db, eventId, actorId, occurrenceId);
  return buildSpeakerPromotionSource(await read.decode(await db.batch(read.statements)), actorId, origin);
}

export async function getAttendeePromotionKit(db: DatabaseLike, eventId: string, userId: string, origin: string) {
  const read = preparePromotionSourceRead(db, eventId, userId, null);
  return buildAttendeePromotionSource(await read.decode(await db.batch(read.statements)), userId, origin);
}
