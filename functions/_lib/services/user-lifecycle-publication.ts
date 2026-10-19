import type { DatabaseLike, StatementLike } from "../types";
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "./people/profile-publication-sql";
import { PUBLIC_LEADERSHIP_SOURCE_SQL, PUBLIC_SEAT_SOURCE_SQL } from "./people/published-person";
import { PUBLIC_MEMBER_USER_SOURCE_SQL } from "./membership/public-profile-sql";
import { groupSeatChangePublicationCondition } from "./groups/seat-publication";
import { prepareSitePublicationRequest } from "./site-publication-requests";

/** Capture the public member/person/group data that offboarding/redaction removes, before the caller changes it. */
export function prepareUserLifecyclePublication(
  db: DatabaseLike,
  userId: string,
  at: string,
  operation: "deactivate" | "anonymize",
): StatementLike {
  const anonymizing = operation === "anonymize" ? 1 : 0;
  const groups = groupSeatChangePublicationCondition({
    sql: `SELECT id,group_id,user_id,member_id,left_at,1 AS closes,1 AS membership_changed
      FROM group_memberships WHERE user_id=? AND left_at IS NULL`,
    bindings: [userId],
  });
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: "user_profile",
      resourceId: userId,
      revision: Date.parse(at),
      reasonCode: "user_profile_changed",
      deduplicationKey: `user-lifecycle:${userId}:${crypto.randomUUID()}`,
    },
    {
      sql: `EXISTS(SELECT 1 ${PUBLIC_MEMBER_USER_SOURCE_SQL} AND person.id=? AND (
      identity.organization_id IS NOT NULL
      OR (?=1 AND (NULLIF(person.first_name,'') IS NOT NULL OR NULLIF(person.last_name,'') IS NOT NULL
        OR NULLIF(person.headshot_r2_key,'') IS NOT NULL))
      OR (identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
        AND (identity.biography IS NOT NULL OR CASE WHEN json_valid(identity.links_json)
          THEN json_array_length(identity.links_json)>0 ELSE 0 END))))
      OR EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL} AND person.id=? AND (
        ?=1 OR EXISTS(SELECT 1 FROM identities shown WHERE shown.user_id=person.id
          AND shown.started_at IS NOT NULL AND shown.ended_at IS NULL AND shown.blocked_at IS NULL
          AND shown.hidden_from_public_profile=0)
        OR EXISTS(SELECT 1 ${PUBLIC_SEAT_SOURCE_SQL} AND membership.user_id=person.id AND membership.left_at IS NULL)
        OR EXISTS(SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL} AND ur.user_id=person.id AND ur.revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM identities held WHERE held.id=ur.identity_id AND held.ended_at IS NULL))))
      OR ${groups.sql}
      OR EXISTS(SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL} AND ur.user_id=? AND ur.revoked_at IS NULL
        AND (?=1 OR EXISTS(SELECT 1 FROM identities held WHERE held.id=ur.identity_id AND held.ended_at IS NULL)))
      OR (?=1 AND EXISTS(SELECT 1 FROM identities held JOIN users person ON person.id=held.user_id
        WHERE held.user_id=?
          AND (NULLIF(person.first_name,'') IS NOT NULL OR NULLIF(person.last_name,'') IS NOT NULL
            OR person.headshot_r2_key IS NOT NULL
            OR (held.organization_id IS NOT NULL AND held.job_title IS NOT NULL)
            OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(held.links_json) THEN held.links_json ELSE '[]' END)))
          AND (EXISTS(SELECT 1 ${PUBLIC_SEAT_SOURCE_SQL} AND membership.identity_id=held.id)
            OR EXISTS(SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL} AND ur.identity_id=held.id))))`,
      bindings: [
        userId,
        anonymizing,
        userId,
        anonymizing,
        ...groups.bindings,
        userId,
        anonymizing,
        anonymizing,
        userId,
      ],
    },
  );
}
