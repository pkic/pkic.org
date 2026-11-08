import type { DatabaseLike, StatementLike } from "../../types";
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "../people/profile-publication-sql";
import { PUBLIC_LEADERSHIP_SOURCE_SQL, PUBLIC_SEAT_SOURCE_SQL } from "../people/published-person";
import { PUBLIC_MEMBER_USER_SOURCE_SQL } from "../membership/public-profile-sql";
import { groupSeatChangePublicationCondition } from "../groups/seat-publication";
import { prepareSitePublicationRequest } from "../site-publication-requests";

const ACTIVE_IDENTITY_SQL = "held.started_at IS NOT NULL AND held.ended_at IS NULL AND held.blocked_at IS NULL";
const GROUP_SEAT_COLUMNS_SQL = "seat.id,seat.group_id,seat.user_id,seat.member_id,seat.left_at";

/** Profile visibility shared by lifecycle transitions and erasure. */
function identityProfilePublicationCondition(identityId: string) {
  return {
    sql: `EXISTS(SELECT 1 ${PUBLIC_MEMBER_USER_SOURCE_SQL}
        AND identity.id=?)
      OR EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL}
        AND person.id=(SELECT identity.user_id FROM identities identity WHERE identity.id=?
          AND identity.started_at IS NOT NULL
          AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
          AND (identity.hidden_from_public_profile=0
            OR EXISTS(SELECT 1 ${PUBLIC_SEAT_SOURCE_SQL} AND membership.identity_id=identity.id AND membership.left_at IS NULL)
            OR EXISTS(SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL} AND ur.identity_id=identity.id AND ur.revoked_at IS NULL))))`,
    bindings: [identityId, identityId],
  };
}

/** Public data changed by ending an identity or restoring its public capacities. */
export function identityLifecyclePublicationCondition(identityId: string) {
  const profile = identityProfilePublicationCondition(identityId);
  const groups = groupSeatChangePublicationCondition({
    sql: `SELECT ${GROUP_SEAT_COLUMNS_SQL},1 AS closes,1 AS membership_changed
      FROM group_memberships seat JOIN identities held ON held.id=seat.identity_id
      WHERE held.id=? AND ${ACTIVE_IDENTITY_SQL} AND seat.left_at IS NULL`,
    bindings: [identityId],
  });
  return {
    sql: `${profile.sql} OR ${groups.sql}`,
    bindings: [...profile.bindings, ...groups.bindings],
  };
}

/** Erasure also removes former roster seats and leadership terms from person timelines. */
export function identityErasurePublicationCondition(identityId: string) {
  const profile = identityProfilePublicationCondition(identityId);
  const groups = groupSeatChangePublicationCondition({
    sql: `SELECT ${GROUP_SEAT_COLUMNS_SQL},(seat.left_at IS NULL) AS closes,
        (${ACTIVE_IDENTITY_SQL} AND seat.left_at IS NULL) AS membership_changed
      FROM group_memberships seat JOIN identities held ON held.id=seat.identity_id
      WHERE held.id=?`,
    bindings: [identityId],
  });
  const leadershipHistory = {
    sql: `EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL}
      AND EXISTS(SELECT 1 ${PUBLIC_LEADERSHIP_SOURCE_SQL}
        AND ur.user_id=person.id AND ur.identity_id=?))`,
    bindings: [identityId],
  };
  return {
    sql: `${profile.sql} OR ${leadershipHistory.sql} OR ${groups.sql}`,
    bindings: [...profile.bindings, ...leadershipHistory.bindings, ...groups.bindings],
  };
}

/** Inside the transaction: before withdrawal, or after activation/audit and public capacity restoration. */
export function prepareOrganizationIdentityPublication(
  db: DatabaseLike,
  identityId: string,
  at: string,
  condition = identityLifecyclePublicationCondition(identityId),
): StatementLike {
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: "identity_profile",
      resourceId: identityId,
      revision: Date.parse(at),
      reasonCode: "identity_profile_changed",
      deduplicationKey: `identity-profile:${identityId}:${crypto.randomUUID()}`,
    },
    condition,
  );
}
