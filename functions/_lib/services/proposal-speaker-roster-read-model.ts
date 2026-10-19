/**
 * The proposal speaker roster as organizers manage it, read through the one
 * speaker read model (`proposal-speaker-profile-projection.ts`) rather than
 * from copies on the roster row.
 */
import type { DatabaseLike, StatementLike } from "../types";
import { proposalSpeakerIdentityIdSql } from "./proposal-speaker-profile-projection";
import { PROPOSAL_SPEAKER_WITH_USER_COLUMNS, type ProposalSpeakerWithUser } from "./proposal-speakers";

/** A roster speaker with the identity they speak as named, so staff can edit that identity itself. */
export interface ProposalSpeakerWithIdentity extends ProposalSpeakerWithUser {
  identity_id: string | null;
}

export function prepareProposalSpeakerRosterWithIdentity(db: DatabaseLike, proposalId: string): StatementLike {
  return db
    .prepare(
      `SELECT ${PROPOSAL_SPEAKER_WITH_USER_COLUMNS},
              ${proposalSpeakerIdentityIdSql("ps")} AS identity_id
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
       WHERE ps.proposal_id = ?
       ORDER BY ps.created_at ASC`,
    )
    .bind(proposalId);
}
