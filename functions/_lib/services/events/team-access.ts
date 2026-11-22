import { EVENT_TEAM_ROLE_IDS } from "../../../../assets/shared/schemas/event-team";
import type { AuthorizationEvidence } from "../../db/authorization-guard";

const TEAM_ROLE_IDS = Object.values(EVENT_TEAM_ROLE_IDS);

/** The person's active team roles on events; each caller narrows them to an event or to a group's events. */
const ACTIVE_TEAM_ROLE = `team_role.user_id = ? AND team_role.context_type = 'event'
  AND team_role.role_id IN (${TEAM_ROLE_IDS.map(() => "?").join(", ")})
  AND team_role.revoked_at IS NULL
  AND (team_role.expires_at IS NULL OR team_role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/** The person is on the event's team. `eventIdExpression` is an internal SQL expression, never request input. */
export function eventTeamMemberEvidence(userId: string, eventIdExpression: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM user_roles team_role WHERE ${ACTIVE_TEAM_ROLE} AND team_role.context_id = ${eventIdExpression}`,
    bindings: [userId, ...TEAM_ROLE_IDS],
  };
}

/**
 * The person is a guest of the group: on the team of an event the group owns, without joining the group.
 * A guest reaches that event's record in the group and nothing else of it. `groupIdExpression` is an internal
 * SQL expression, never request input.
 */
export function groupGuestEvidence(userId: string, groupIdExpression: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM user_roles team_role JOIN events team_event ON team_event.id = team_role.context_id
           WHERE ${ACTIVE_TEAM_ROLE} AND team_event.owner_group_id = ${groupIdExpression}`,
    bindings: [userId, ...TEAM_ROLE_IDS],
  };
}
