/**
 * The roster row and proposal state a speaker's own write was authorized
 * against. A write commits only while both are still what was read, so a
 * speaker removed, re-invited or closed out meanwhile changes nothing.
 */
import type { DatabaseLike, StatementLike } from "../types";
import type { ParticipantAuthority } from "./participant-authority";

export interface ProposalSpeakerAuthoritySnapshot {
  proposalSpeakerId: string;
  proposalId: string;
  proposalStatus: string;
  proposalUpdatedAt: string;
  userId: string;
  currentStatus: string;
  inviteGeneration: number;
}

/** What a speaker's own profile write was read against, including the identity choice it may change. */
export interface ProposalSpeakerWriteContext extends ProposalSpeakerAuthoritySnapshot {
  expectedActingIdentityId?: string | null;
  expectedActingIdentitySelectedAt?: string | null;
  authority?: ParticipantAuthority;
  expectedManageLinkSecret?: string | null;
}

export function proposalSpeakerAuthorityCondition(context: ProposalSpeakerAuthoritySnapshot): {
  sql: string;
  bindings: unknown[];
} {
  return {
    sql: `EXISTS (
      SELECT 1
        FROM proposal_speakers ps
        JOIN session_proposals sp ON sp.id = ps.proposal_id
       WHERE ps.id = ? AND ps.proposal_id = ? AND ps.user_id = ? AND ps.status = ? AND ps.invite_generation = ?
         AND sp.id = ? AND sp.status = ? AND sp.updated_at = ? AND sp.deleted_at IS NULL
    )`,
    bindings: [
      context.proposalSpeakerId,
      context.proposalId,
      context.userId,
      context.currentStatus,
      context.inviteGeneration,
      context.proposalId,
      context.proposalStatus,
      context.proposalUpdatedAt,
    ],
  };
}

/**
 * Locks a speaker's write to the roster row and proposal snapshot that
 * authorized it. SQLite reports one changed row for a matched no-op UPDATE,
 * so the caller's immediately following one-change audit guard aborts the
 * batch when anything moved.
 */
export function prepareProposalSpeakerWriteGuard(
  db: DatabaseLike,
  context: ProposalSpeakerWriteContext,
): StatementLike {
  return db
    .prepare(
      `UPDATE proposal_speakers
          SET invite_generation = invite_generation
        WHERE id = ? AND proposal_id = ? AND user_id = ? AND status = ? AND invite_generation = ?
          AND acting_identity_id IS ? AND acting_identity_selected_at IS ?
          AND EXISTS (
            SELECT 1 FROM session_proposals
             WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
          )`,
    )
    .bind(
      context.proposalSpeakerId,
      context.proposalId,
      context.userId,
      context.currentStatus,
      context.inviteGeneration,
      context.expectedActingIdentityId ?? null,
      context.expectedActingIdentitySelectedAt ?? null,
      context.proposalId,
      context.proposalStatus,
      context.proposalUpdatedAt,
    );
}
