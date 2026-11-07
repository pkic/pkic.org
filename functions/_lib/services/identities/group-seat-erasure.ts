import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLogAfterOneChange, selectAuditDetails, serializeAuditDetails } from "../audit";
import { groupErasureAuditSelection, groupErasurePreimageSelection } from "./group-erasure-preimage";

/** One indivisible statement sequence: capture, erase, guarded identity deletion/audit, release marker. */
export function prepareIncorrectRepresentationGroupErasure(
  db: DatabaseLike,
  input: {
    identityId: string;
    ownerId: string;
    actorId: string;
    at: string;
    auditAction: string;
    auditDetails: unknown;
  },
  deleteIdentity: StatementLike,
): StatementLike[] {
  const { identityId, ownerId, actorId, at, auditAction, auditDetails } = input;
  const preimage = groupErasurePreimageSelection(identityId, ownerId);
  const audit = groupErasureAuditSelection(identityId, serializeAuditDetails(auditDetails));
  return [
    // The existing marker's JSON column holds the complete erasure preimage, including cascade effects.
    db
      .prepare(`INSERT INTO group_membership_erasures(identity_id,created_at,erased_seats_json)
      SELECT ?,?,(${preimage.sql})`)
      .bind(identityId, at, ...preimage.bindings),
    // Incorrect grants are erased, never transferred; capture them before the delete.
    db.prepare("DELETE FROM user_roles WHERE identity_id=? AND user_id=?").bind(identityId, ownerId),
    db
      .prepare(`UPDATE group_memberships SET left_at=MAX(joined_at,?),updated_at=?
      WHERE identity_id=? AND user_id=? AND left_at IS NULL`)
      .bind(at, at, identityId, ownerId),
    db.prepare("DELETE FROM group_memberships WHERE identity_id=? AND user_id=?").bind(identityId, ownerId),
    deleteIdentity,
    prepareAuditLogAfterOneChange(
      db,
      "user",
      actorId,
      auditAction,
      "identity",
      identityId,
      selectAuditDetails(audit.sql, audit.bindings),
      at,
    ),
    db.prepare("DELETE FROM group_membership_erasures WHERE identity_id=?").bind(identityId),
  ];
}
