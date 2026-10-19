import { liveProgramOverlayAccessHours } from "../../../../assets/shared/live-room-program-policy";
import { liveOverlayAccessResponseSchema } from "../../../../assets/shared/schemas/live-session-room";
import { signLiveOverlayToken } from "../../auth/live-session-overlay-token";
import type { DatabaseLike, Env } from "../../types";
import { addHours, nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { readPublishedProgramRoom } from "./program-room";

/**
 * Issues a broadcast overlay's read-only access to one physical room's program. The
 * access expires on its own; issuing it is audited against the event.
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
  const expiresAt = addHours(issuedAt, liveProgramOverlayAccessHours(room.firstStartAt, room.lastEndAt));
  const token = await signLiveOverlayToken(env.INTERNAL_SIGNING_SECRET, {
    eventId,
    roomId,
    issuedBy: operatorUserId,
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
