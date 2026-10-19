import type { UserAuthLogoutResponse } from "../../../assets/shared/schemas/user-auth";
import type { DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { assertSessionActive, fetchSessionRow, getBearerToken } from "./session-engine";
import { getUserSessionCookieToken, getUserSessionToken, verifyUserSessionToken } from "./user-session-token";

const userSessions = { table: "sessions", subjectColumn: "user_id" };
type LogoutOutcome = UserAuthLogoutResponse["outcome"];

/** A stored nonsecret session ID can narrow revocation, but never authorize it. */
export async function logoutUserSession(
  db: DatabaseLike,
  request: Request,
  signingSecret: string | undefined,
  expectedSessionId?: string,
): Promise<LogoutOutcome> {
  const conditional = expectedSessionId !== undefined;
  const token = conditional
    ? getUserSessionToken(request)
    : (getBearerToken(request) ?? getUserSessionCookieToken(request));
  if (!token || !signingSecret) return "no_current_session";
  const verified = await verifyUserSessionToken(signingSecret, token);
  if (!verified.ok) return "no_current_session";
  const { sid, sub } = verified.claims;
  const row = await fetchSessionRow(db, userSessions, sid, sub);
  if (!row) return "no_current_session";
  if (!conditional) {
    assertSessionActive(row, "user");
    await db
      .prepare("UPDATE sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?")
      .bind(nowIso(), sid, sub)
      .run();
    return "revoked";
  }
  const now = nowIso();
  const ended = row.revokedAt !== null || row.expiresAt <= now;
  if (sid !== expectedSessionId) return ended ? "no_current_session" : "session_changed";
  if (ended) return "already_ended";

  // The owner and instance remain part of the write, including after preflight.
  const result = await db
    .prepare("UPDATE sessions SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?")
    .bind(now, sid, sub, now)
    .run();
  if (result.meta?.changes === 1) return "revoked";
  const current = await fetchSessionRow(db, userSessions, sid, sub);
  return current && (current.revokedAt !== null || current.expiresAt <= nowIso())
    ? "already_ended"
    : "no_current_session";
}
