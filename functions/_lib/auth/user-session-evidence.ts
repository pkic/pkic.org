import type { AuthorizationEvidence } from "../db/authorization-guard";
import type { UserSessionTokenClaims } from "./user-session-token";
import { userSessionAuthorizationEvidence, STAFF_ACCESS_CONDITION } from "./identity-capacities";
import {
  DEFAULT_USER_SESSION_IDLE_TTL_HOURS,
  STAFF_SESSION_IDLE_TTL_HOURS,
  STAFF_CAPACITY_TTL_HOURS,
  sessionIdleExpiresAt,
} from "./session-policy";

/** Current-user commands retain the canonical absolute, idle, elevation, and live sign-in limits atomically. */
export function userSessionRequestAuthorizationEvidence(
  claims: UserSessionTokenClaims,
  requireStaff = false,
): AuthorizationEvidence {
  const live = userSessionAuthorizationEvidence(claims.sub, claims.sid);
  const deadline = (activity: number | undefined, hours: number) =>
    activity === undefined
      ? { sql: "strftime('%Y-%m-%dT%H:%M:%fZ',active_session.created_at,?)", bindings: [`+${hours} hours`] }
      : { sql: "?", bindings: [sessionIdleExpiresAt(activity, new Date(claims.exp * 1000).toISOString(), hours)] };
  const idle = deadline(claims.lastActivityAt, DEFAULT_USER_SESSION_IDLE_TTL_HOURS),
    staff = deadline(claims.staffLastActivityAt, STAFF_SESSION_IDLE_TTL_HOURS);
  return {
    sql: `SELECT 1 FROM sessions active_session JOIN users u ON u.id=active_session.user_id AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL WHERE active_session.id=? AND active_session.user_id=? AND EXISTS(${live.sql}) AND ${idle.sql}>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${requireStaff ? `(${STAFF_ACCESS_CONDITION}) AND` : `NOT(${STAFF_ACCESS_CONDITION}) OR`} (strftime('%Y-%m-%dT%H:%M:%fZ',active_session.created_at,?)>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${staff.sql}>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    bindings: [
      claims.sid,
      claims.sub,
      ...live.bindings,
      ...idle.bindings,
      `+${STAFF_CAPACITY_TTL_HOURS} hours`,
      ...staff.bindings,
    ],
  };
}
