/** Statuses that hold a place on a session: a seat, a request awaiting approval, or a waiting-list place. */
export const HELD_PARTICIPATION_STATUSES = ["reserved", "approval_pending", "waitlisted"] as const;
export const heldParticipationStatusesSql = HELD_PARTICIPATION_STATUSES.map((status) => `'${status}'`).join(",");
/** Canonical private-session audience, with session s, own participation p, and the viewer bound once. */
export const privateSessionAccessSql = `(p.status IN ('reserved','approval_pending') OR EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=s.id AND invitation.user_id=? AND invitation.revoked_at IS NULL))`;

/**
 * The one rule for "on my agenda": the session is starred, or the person holds a place on it.
 * The star lives only in `saved`; the seat lives in `status`. Releasing a seat leaves the star,
 * so a released seat stays on the agenda until the person unstars it.
 */
export function onPersonalAgendaSql(alias: string) {
  return `(${alias}.saved=1 OR ${alias}.status IN (${heldParticipationStatusesSql}))`;
}
