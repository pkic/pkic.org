import { liveProgramOverlayExpiresAt } from "../../../../assets/shared/live-room-program-policy";
import { liveOverlayAccessResponseSchema } from "../../../../assets/shared/schemas/live-overlay-access";
import { LIVE_OVERLAY_ROOM_ISSUER, signLiveOverlayToken } from "../../auth/live-session-overlay-token";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { readPublishedProgramRoom } from "./program-room";

/**
 * Issues a broadcast overlay's read-only access to one physical room's program:
 * the same links each time until a day after the program ends. Each request
 * is audited against the event.
 */
export async function issueLiveOverlayAccess(
  db: DatabaseLike,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  eventId: string,
  roomId: string,
  operatorUserId: string,
) {
  const room = await readPublishedProgramRoom(db, eventId, roomId);
  const issuedAt = nowIso();
  // The same room and program give the same links, whoever asks and whenever: an operator finds them again.
  const expiresAt = liveProgramOverlayExpiresAt(room.lastEndAt, Date.parse(issuedAt));
  const token = await signLiveOverlayToken(env.INTERNAL_SIGNING_SECRET, {
    eventId,
    roomId,
    issuedBy: LIVE_OVERLAY_ROOM_ISSUER,
    expiresAt,
  });
  await db.batch([
    prepareScopedAuditLog(
      db,
      { type: "event", id: eventId },
      "user",
      operatorUserId,
      "live_session.overlay_access.issued",
      "event_agenda_room",
      roomId,
      { expiresAt },
      issuedAt,
    ),
  ]);
  return liveOverlayAccessResponseSchema.parse({ token, expiresAt });
}
