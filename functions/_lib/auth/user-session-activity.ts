import type { UserSessionTokenClaims } from "./user-session-token";

type SessionActivityClaims = Required<Pick<UserSessionTokenClaims, "lastActivityAt" | "staffLastActivityAt">>;

/**
 * The activity a session carries once the server has seen its holder again.
 * Staff elevation's activity moves only while the elevation is active, so an
 * elevation that sat idle, or a role granted later, still asks for a new
 * sign-in.
 */
export function acknowledgedSessionActivity(
  claims: Pick<UserSessionTokenClaims, "staffLastActivityAt">,
  staffActive: boolean,
  atSeconds = Math.floor(Date.now() / 1000),
): SessionActivityClaims {
  return {
    lastActivityAt: atSeconds,
    staffLastActivityAt: staffActive ? atSeconds : (claims.staffLastActivityAt ?? 0),
  };
}

/**
 * The claims a connected socket is checked with. A socket cannot present the
 * token its browser renewed since, so checked as admitted the inactivity
 * limits would be a maximum connection age: an hour for anyone with a role,
 * mid-session and while they work. Staying connected is the activity instead.
 * The session's and the elevation's own lifetimes, and everything D1 knows
 * about the session and its holder, end the connection as before.
 */
export function connectedSessionClaims(claims: UserSessionTokenClaims): UserSessionTokenClaims {
  // A token issued while the elevation was active carries one activity time for both.
  return { ...claims, ...acknowledgedSessionActivity(claims, claims.staffLastActivityAt === claims.lastActivityAt) };
}
