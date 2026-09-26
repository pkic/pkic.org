import { first } from "../db/queries";
import type { DatabaseLike, StatementLike } from "../types";
import { uuid } from "../utils/ids";

/** Reads before listing a proposal roster so a concurrent membership change invalidates the planned rebuild. */
export async function getProposalSpeakerRosterRevision(db: DatabaseLike, proposalId: string): Promise<number> {
  const row = await first<{ revision: number }>(
    db,
    `SELECT COALESCE((
       SELECT revision FROM proposal_speaker_roster_revisions WHERE proposal_id = ?
     ), 0) AS revision`,
    [proposalId],
  );
  return Number(row?.revision ?? 0);
}

export function prepareProposalSpeakerRosterRevisionGuard(
  db: DatabaseLike,
  input: { proposalId: string; expectedRevision: number },
): StatementLike {
  return db
    .prepare(
      `INSERT INTO proposal_speaker_roster_revision_guards (id, proposal_id, expected_revision)
       VALUES (?, ?, ?)`,
    )
    .bind(uuid(), input.proposalId, input.expectedRevision);
}

export function isProposalSpeakerRosterConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("PROPOSAL_SPEAKER_ROSTER_CHANGED");
}
