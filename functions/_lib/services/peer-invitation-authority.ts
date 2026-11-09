/** The same invitation workflow accepts a registration capability or its owner's live session. */
import { CAPABILITY_TOKEN_PREFIX } from "../auth/capability-token";
import { getBearerToken } from "../auth/session-engine";
import { getUserSessionToken } from "../auth/user-session-token";
import { prepareUserSessionRequest } from "../auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../auth/user-session-evidence";
import { guardAuthorizedDatabase } from "../db/authorization-guard";
import { batchFirst } from "../db/pagination";
import { AppError } from "../errors";
import { requireInternalSecret } from "../request";
import type { Env } from "../types";
import { getRegistrationByManageToken } from "./registrations/queries";
import { registrationColumns, type RegistrationRecord } from "./registrations/types";
import { REGISTRATION_ORGANIZATION_SQL } from "./registrations/selected-identity";
import { firstReferralCodeForOwnerSql } from "./referral-code-projection";
import { prepareEventBySlug, type EventRecord } from "./events";

interface PeerInvitationSnapshot extends RegistrationRecord {
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  invite_count: number;
  referral_code: string | null;
}

export async function resolvePeerInvitationAuthority(
  env: Env,
  request: Request,
  eventSlug: string,
  inviteType: "attendee" | "speaker",
) {
  const bearer = getBearerToken(request);
  const capability = bearer?.startsWith(CAPABILITY_TOKEN_PREFIX)
    ? await getRegistrationByManageToken(env.DB, bearer, requireInternalSecret(env))
    : null;
  if (!capability && !getUserSessionToken(request))
    throw new AppError(401, "AUTH_REQUIRED", "Sign in to invite a colleague");
  const sessionRead = capability ? null : await prepareUserSessionRequest(env.DB, request, env);
  const sessionEvidence = sessionRead ? userSessionRequestAuthorizationEvidence(sessionRead.claims) : null;
  const results = await env.DB.batch([
    ...(sessionRead?.statements ?? []),
    prepareEventBySlug(env.DB, eventSlug),
    env.DB.prepare(`SELECT ${registrationColumns("r")}, u.first_name, u.last_name,
        ${REGISTRATION_ORGANIZATION_SQL} AS organization_name,
        (SELECT COUNT(*) FROM invites WHERE event_id=r.event_id AND inviter_user_id=r.user_id AND invite_type=?) AS invite_count,
        ${firstReferralCodeForOwnerSql("registration", "r.id", "r.event_id")} AS referral_code
      FROM registrations r JOIN users u ON u.id=r.user_id
      WHERE r.event_id=(SELECT id FROM events WHERE slug=?)
        AND ${capability ? "r.id=? AND r.user_id=? AND r.manage_link_secret IS ?" : "r.user_id=?"}`).bind(
      inviteType,
      eventSlug,
      ...(capability ? [capability.id, capability.user_id, capability.manage_link_secret] : [sessionRead!.claims.sub]),
    ),
  ]);
  const offset = sessionRead?.statements.length ?? 0;
  if (sessionRead) await sessionRead.decode(results.slice(0, offset));
  const event = batchFirst<EventRecord>(results[offset]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  if (capability && capability.event_id !== event.id)
    throw new AppError(403, "EVENT_MISMATCH", "Token is not valid for this event");
  const registration = batchFirst<PeerInvitationSnapshot>(results[offset + 1]);
  if (!registration || registration.status === "cancelled")
    throw new AppError(403, "REGISTRATION_REQUIRED", "An active registration is required to invite a colleague");
  const db = guardAuthorizedDatabase(
    env.DB,
    {
      sql: `${sessionEvidence ? `WITH inviter_session AS MATERIALIZED (${sessionEvidence.sql})` : ""}
      SELECT 1 FROM registrations registration JOIN users person ON person.id=registration.user_id
      WHERE registration.id=? AND registration.event_id=? AND registration.user_id=?
        AND registration.status=? AND registration.manage_link_secret IS ?
        AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
        ${sessionEvidence ? "AND EXISTS (SELECT 1 FROM inviter_session)" : ""}`,
      bindings: [
        ...(sessionEvidence?.bindings ?? []),
        registration.id,
        event.id,
        registration.user_id,
        registration.status,
        registration.manage_link_secret,
      ],
    },
    () =>
      new AppError(
        403,
        "INVITER_ACCESS_CHANGED",
        "Your registration or sign-in changed. Refresh before inviting a colleague.",
      ),
  );
  return { registration, event, db };
}
