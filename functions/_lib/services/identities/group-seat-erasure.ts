import type { DatabaseLike, StatementLike } from "../../types";
import { serializeAuditDetails } from "../audit";

/** Capture the preimage, then end seats before erasure so hierarchy and authority triggers run. */
export function prepareIncorrectRepresentationGroupErasure(
  db: DatabaseLike,
  identityId: string,
  userId: string,
  at: string,
): StatementLike[] {
  return [
    db
      .prepare(`INSERT INTO group_membership_erasures(identity_id,created_at,erased_seats_json)
      SELECT ?,?,json_group_array(json_object('seatId',id,'groupId',group_id,
        'memberId',member_id,'joinedAt',joined_at,'leftAt',left_at))
      FROM (SELECT id,group_id,member_id,joined_at,left_at FROM group_memberships
        WHERE identity_id=? AND user_id=? ORDER BY id)`)
      .bind(identityId, at, identityId, userId),
    db
      .prepare(`UPDATE group_memberships SET left_at=MAX(joined_at,?),updated_at=?
      WHERE identity_id=? AND user_id=? AND left_at IS NULL`)
      .bind(at, at, identityId, userId),
    db.prepare("DELETE FROM group_memberships WHERE identity_id=? AND user_id=?").bind(identityId, userId),
  ];
}

/** Read the transaction's snapshot without a separate read or an audit mutation. */
export function incorrectRepresentationErasureAuditDetails(identityId: string, details: unknown) {
  return {
    sql: `SELECT json_set(?, '$.erasedGroupSeats',
      json_object('from',json(erased_seats_json),'to',NULL))
      FROM group_membership_erasures WHERE identity_id=?`,
    bindings: [serializeAuditDetails(details), identityId],
  };
}
