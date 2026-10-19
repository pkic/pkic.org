import { PUBLIC_CURRENT_GROUP_LEADERSHIP_SOURCE_SQL } from "./public-leadership-sql";
import { PUBLIC_LEADERSHIP_SOURCE_SQL, PUBLIC_SEAT_SOURCE_SQL } from "../people/published-person";

/** The identity data actually shown by public group rosters and current/past leadership. */
export function publicGroupProfileIdentityPredicate(identityAlias: "edited" | "held"): string {
  return `(EXISTS(SELECT 1 ${PUBLIC_SEAT_SOURCE_SQL} AND membership.identity_id=${identityAlias}.id
          AND (membership.left_at IS NOT NULL OR EXISTS(SELECT 1 FROM users seated WHERE seated.id=membership.user_id AND seated.active=1)))
        OR EXISTS(SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL} AND ur.identity_id=${identityAlias}.id
          AND (ur.revoked_at IS NOT NULL OR ur.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
        OR EXISTS(WITH RECURSIVE effective_lineage(id,depth) AS (
          SELECT DISTINCT context_id,0 FROM user_roles WHERE context_type='group' AND user_id=${identityAlias}.user_id),
          sources AS (SELECT source_group.id ${PUBLIC_CURRENT_GROUP_LEADERSHIP_SOURCE_SQL} WHERE identity.id=${identityAlias}.id),
          descendants(id) AS (SELECT id FROM sources UNION SELECT child.id FROM descendants parent
            JOIN groups child ON child.parent_group_id=parent.id WHERE child.governance_inheritance_mode='inherited')
          SELECT 1 FROM descendants JOIN groups published ON published.id=descendants.id
            WHERE published.active=1 AND published.public_leadership=1))`;
}

/** Includes historical identities: changing the holder's name or photo also changes past public terms. */
export function publicGroupProfileUserCondition(userId: string) {
  return {
    sql: `EXISTS(SELECT 1 FROM identities held WHERE held.user_id=? AND ${publicGroupProfileIdentityPredicate("held")})`,
    bindings: [userId],
  };
}
