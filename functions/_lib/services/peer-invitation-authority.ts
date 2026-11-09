/** The same invitation workflow accepts a registration capability or its owner's live session. */
import { CAPABILITY_TOKEN_PREFIX } from "../auth/capability-token";
import { getBearerToken } from "../auth/session-engine";
import { getUserSessionToken } from "../auth/user-session-token";
import { prepareUserSessionRequest } from "../auth/user-session-request";
import { guardAuthorizedDatabase } from "../db/authorization-guard";
import { batchFirst } from "../db/pagination";
import { AppError } from "../errors";
import { requireInternalSecret } from "../request";
import type { Env } from "../types";
import { getRegistrationByManageToken, prepareRegistrationBySelection } from "./registrations/queries";
import type { RegistrationRecord } from "./registrations/types";

export async function resolvePeerInvitationAuthority(env: Env, request: Request, eventId: string) {
  const bearer = getBearerToken(request);
  let registration: RegistrationRecord;
  let sessionId: string | null = null;
  if (bearer?.startsWith(CAPABILITY_TOKEN_PREFIX)) {
    registration = await getRegistrationByManageToken(env.DB, bearer, requireInternalSecret(env));
    if (registration.event_id !== eventId)
      throw new AppError(403, "EVENT_MISMATCH", "Token is not valid for this event");
  } else {
    if (!getUserSessionToken(request)) throw new AppError(401, "AUTH_REQUIRED", "Sign in to invite a colleague");
    const sessionRead = await prepareUserSessionRequest(env.DB, request, env);
    const results = await env.DB.batch([
      ...sessionRead.statements,
      prepareRegistrationBySelection(env.DB, { eventId, userId: sessionRead.claims.sub }),
    ]);
    const session = await sessionRead.decode(results.slice(0, sessionRead.statements.length));
    const owned = batchFirst<RegistrationRecord>(results[sessionRead.statements.length]);
    if (!owned) throw new AppError(403, "REGISTRATION_REQUIRED", "Register for this event before inviting a colleague");
    registration = owned;
    sessionId = session.sessionId;
  }
  if (registration.status !== "registered")
    throw new AppError(403, "REGISTRATION_REQUIRED", "A confirmed registration is required to invite a colleague");
  const db = guardAuthorizedDatabase(
    env.DB,
    {
      sql: `SELECT 1 FROM registrations registration JOIN users person ON person.id=registration.user_id
      WHERE registration.id=? AND registration.event_id=? AND registration.user_id=?
        AND registration.status=? AND registration.manage_link_secret IS ?
        AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
        ${
          sessionId
            ? `AND EXISTS (SELECT 1 FROM sessions session WHERE session.id=?
          AND session.user_id=registration.user_id AND session.revoked_at IS NULL
          AND session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
            : ""
        }`,
      bindings: [
        registration.id,
        eventId,
        registration.user_id,
        registration.status,
        registration.manage_link_secret,
        ...(sessionId ? [sessionId] : []),
      ],
    },
    () =>
      new AppError(
        403,
        "INVITER_ACCESS_CHANGED",
        "Your registration or sign-in changed. Refresh before inviting a colleague.",
      ),
  );
  return { registration, db };
}
