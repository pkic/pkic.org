import { AppError } from "../errors";
import { signJwt, verifyJwt } from "../utils/jwt";

const OVERLAY_TOKEN_TYPE = "live-session-overlay";

/** A read-only overlay's access to one physical room's broadcast program, issued by a staff operator. */
export interface LiveOverlayClaims {
  typ: typeof OVERLAY_TOKEN_TYPE;
  /** The event the room belongs to. */
  evt: string;
  /** The physical room the continuous source follows. */
  room: string;
  /** The operator who issued the access, for attribution. */
  iss: string;
  exp: number;
}

function signingSecret(secret: string | undefined): string {
  if (!secret) throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  return secret;
}

export async function signLiveOverlayToken(
  secret: string | undefined,
  access: { eventId: string; roomId: string; issuedBy: string; expiresAt: string },
): Promise<string> {
  const claims: LiveOverlayClaims = {
    typ: OVERLAY_TOKEN_TYPE,
    evt: access.eventId,
    room: access.roomId,
    iss: access.issuedBy,
    exp: Math.floor(Date.parse(access.expiresAt) / 1000),
  };
  return signJwt(signingSecret(secret), { ...claims });
}

/** The access a token grants for exactly this room, or null when it is invalid, expired or for another room. */
export async function verifyLiveOverlayToken(
  secret: string | undefined,
  token: string,
  room: { eventId: string; roomId?: string },
): Promise<LiveOverlayClaims | null> {
  const result = await verifyJwt<Partial<LiveOverlayClaims>>(signingSecret(secret), token);
  if (!result.ok) return null;
  const claims = result.claims;
  if (
    claims.typ !== OVERLAY_TOKEN_TYPE ||
    claims.evt !== room.eventId ||
    (room.roomId !== undefined && claims.room !== room.roomId)
  )
    return null;
  if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000)
    return null;
  if (typeof claims.room !== "string" || !claims.room) return null;
  if (typeof claims.iss !== "string" || !claims.iss) return null;
  return claims as LiveOverlayClaims;
}
