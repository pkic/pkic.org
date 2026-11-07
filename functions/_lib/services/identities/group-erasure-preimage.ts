import { groupSeatChangeDefinitions } from "../groups/seat-change-selection";
import { LEADERSHIP_ROLE_PREDICATE_SQL } from "../groups/leadership-sql";

/** Complete persisted seat fields, including former roster titles and provenance. */
function seatSnapshotSql() {
  return `json_object('seatId',seat.id,'groupId',seat.group_id,'userId',seat.user_id,
    'identityId',seat.identity_id,'memberId',seat.member_id,'source',seat.source,
    'createdByUserId',seat.created_by_user_id,'title',seat.title,
    'joinedAt',seat.joined_at,'leftAt',seat.left_at,'createdAt',seat.created_at,'updatedAt',seat.updated_at)`;
}

function roleSnapshotSql() {
  return `json_object('roleAssignmentId',ur.id,'userId',ur.user_id,'roleId',ur.role_id,
    'contextType',ur.context_type,'contextId',ur.context_id,'identityId',ur.identity_id,
    'memberId',ur.member_id,'title',ur.title,'startsAt',ur.starts_at,
    'grantedByUserId',ur.granted_by_user_id,'expiresAt',ur.expires_at,'revokedAt',ur.revoked_at,
    'singleHolderPerContext',ur.single_holder_per_context,'createdAt',ur.created_at)`;
}

function snapshotArray(rowSql: string, fromSql: string, orderSql: string) {
  return `(SELECT json_group_array(json(snapshot)) FROM
    (SELECT ${rowSql} AS snapshot ${fromSql} ORDER BY ${orderSql}))`;
}

/** Snapshot the trigger's exact cascade, including seats held through other identities. */
export function groupErasurePreimageSelection(identityId: string, userId: string) {
  const affected = groupSeatChangeDefinitions({
    sql: `SELECT id,group_id,user_id,member_id,left_at,(left_at IS NULL) AS closes,1 AS membership_changed
      FROM group_memberships WHERE identity_id=(SELECT identity_id FROM removal_context)
        AND user_id=(SELECT user_id FROM removal_context)`,
  });
  const erased = `FROM group_memberships seat JOIN selected ON selected.id=seat.id`;
  const ended = `FROM group_memberships seat JOIN affected ON affected.id=seat.id
    WHERE seat.identity_id<>(SELECT identity_id FROM removal_context) AND seat.left_at IS NULL`;
  const removedRoles = `FROM user_roles ur WHERE ur.identity_id=(SELECT identity_id FROM removal_context)
    AND ur.user_id=(SELECT user_id FROM removal_context)`;
  const revokedRoles = `FROM user_roles ur WHERE ur.user_id=(SELECT user_id FROM removal_context)
    AND ur.identity_id IS NOT (SELECT identity_id FROM removal_context)
    AND ur.revoked_at IS NULL AND ${LEADERSHIP_ROLE_PREDICATE_SQL} AND ur.context_type='group'
    AND EXISTS(SELECT 1 FROM affected WHERE affected.closes=1 AND affected.group_id=ur.context_id
      AND affected.user_id=ur.user_id AND affected.member_id=ur.member_id)`;
  return {
    sql: `WITH RECURSIVE removal_context AS (SELECT ? AS identity_id,? AS user_id),${affected}
      SELECT json_object(
        'erasedGroupSeats',${snapshotArray(seatSnapshotSql(), erased, "seat.id")},
        'endedGroupSeats',${snapshotArray(seatSnapshotSql(), ended, "seat.id")},
        'removedIdentityRoles',${snapshotArray(roleSnapshotSql(), removedRoles, "ur.id")},
        'revokedGroupRoles',${snapshotArray(roleSnapshotSql(), revokedRoles, "ur.id")})`,
    bindings: [identityId, userId],
  };
}

/** Pair the captured preimage with actual committed seat/role states for the audit delta. */
export function groupErasureAuditSelection(identityId: string, serializedDetails: string) {
  return {
    sql: `SELECT json_set(?,
      '$.erasedGroupSeats',json_object('from',json_extract(erased_seats_json,'$.erasedGroupSeats'),'to',NULL),
      '$.endedGroupSeats',json_object('from',json_extract(erased_seats_json,'$.endedGroupSeats'),'to',
        ${snapshotArray(
          seatSnapshotSql(),
          `FROM group_memberships seat
          WHERE seat.id IN (SELECT json_extract(value,'$.seatId') FROM json_each(erased_seats_json,'$.endedGroupSeats'))`,
          "seat.id",
        )}),
      '$.removedIdentityRoles',json_object('from',json_extract(erased_seats_json,'$.removedIdentityRoles'),'to',NULL),
      '$.revokedGroupRoles',json_object('from',json_extract(erased_seats_json,'$.revokedGroupRoles'),'to',
        ${snapshotArray(
          roleSnapshotSql(),
          `FROM user_roles ur
          WHERE ur.id IN (SELECT json_extract(value,'$.roleAssignmentId') FROM json_each(erased_seats_json,'$.revokedGroupRoles'))`,
          "ur.id",
        )}))
      FROM group_membership_erasures WHERE identity_id=?`,
    bindings: [serializedDetails, identityId],
  };
}
