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

/** Capture candidates for this user's trigger effects without predicting the cascade. */
export function groupErasurePreimageSelection(identityId: string, userId: string) {
  const erased = `FROM group_memberships seat WHERE seat.identity_id=(SELECT identity_id FROM removal_context)
    AND seat.user_id=(SELECT user_id FROM removal_context)`;
  const ended = `FROM group_memberships seat WHERE seat.user_id=(SELECT user_id FROM removal_context)
    AND seat.identity_id<>(SELECT identity_id FROM removal_context) AND seat.left_at IS NULL`;
  const removedRoles = `FROM user_roles ur WHERE ur.identity_id=(SELECT identity_id FROM removal_context)
    AND ur.user_id=(SELECT user_id FROM removal_context)`;
  const revokedRoles = `FROM user_roles ur WHERE ur.user_id=(SELECT user_id FROM removal_context)
    AND ur.identity_id IS NOT (SELECT identity_id FROM removal_context) AND ur.revoked_at IS NULL`;
  return {
    sql: `WITH removal_context AS (SELECT ? AS identity_id,? AS user_id)
      SELECT json_object(
        'erasedGroupSeats',${snapshotArray(seatSnapshotSql(), erased, "seat.id")},
        'endedGroupSeats',${snapshotArray(seatSnapshotSql(), ended, "seat.id")},
        'removedIdentityRoles',${snapshotArray(roleSnapshotSql(), removedRoles, "ur.id")},
        'revokedGroupRoles',${snapshotArray(roleSnapshotSql(), revokedRoles, "ur.id")})`,
    bindings: [identityId, userId],
  };
}

/** Pair only actual trigger transitions with their captured preimages. */
export function groupErasureAuditSelection(identityId: string, serializedDetails: string) {
  const delta = (name: string, selection: string) => `'$.${name}',json_object(
    'from',${snapshotArray("before", `FROM ${selection}`, "id")},
    'to',${snapshotArray("after", `FROM ${selection}`, "id")})`;
  return {
    sql: `WITH preimage AS MATERIALIZED (
        SELECT preimage_json FROM group_membership_erasures WHERE identity_id=?),
      ended_seats AS MATERIALIZED (
        SELECT seat.id,value AS before,${seatSnapshotSql()} AS after
        FROM preimage,json_each(preimage_json,'$.endedGroupSeats')
        JOIN group_memberships seat ON seat.id=json_extract(value,'$.seatId')
        WHERE seat.left_at IS NOT json_extract(value,'$.leftAt')),
      revoked_roles AS MATERIALIZED (
        SELECT ur.id,value AS before,${roleSnapshotSql()} AS after
        FROM preimage,json_each(preimage_json,'$.revokedGroupRoles')
        JOIN user_roles ur ON ur.id=json_extract(value,'$.roleAssignmentId')
        WHERE ur.revoked_at IS NOT json_extract(value,'$.revokedAt')),
      audit_details AS (
        SELECT json_set(?,
        '$.erasedGroupSeats',json_object('from',json_extract(preimage_json,'$.erasedGroupSeats'),'to',NULL),
        ${delta("endedGroupSeats", "ended_seats")},
        '$.removedIdentityRoles',json_object('from',json_extract(preimage_json,'$.removedIdentityRoles'),'to',NULL),
        ${delta("revokedGroupRoles", "revoked_roles")}) AS details_json FROM preimage)
      SELECT json_group_object(key,json(value)) FROM audit_details,json_each(details_json)
      WHERE key NOT IN ('erasedGroupSeats','endedGroupSeats','removedIdentityRoles','revokedGroupRoles')
        OR json_array_length(value,'$.from')>0`,
    bindings: [identityId, serializedDetails],
  };
}
