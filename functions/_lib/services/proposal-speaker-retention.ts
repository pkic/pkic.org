import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

/** A decline or rejection may proceed only while another speaker remains. Bind the proposal id. */
export const anotherProposalSpeakerRemainsSql =
  "(SELECT COUNT(*) FROM proposal_speakers WHERE proposal_id = ? AND status <> 'declined') > 1";

/** Gives the same actionable refusal before a write and after a concurrent speaker leaves. */
export async function requireAnotherProposalSpeaker(db: DatabaseLike, proposalId: string): Promise<void> {
  if (!(await first(db, `SELECT 1 WHERE ${anotherProposalSpeakerRemainsSql}`, [proposalId])))
    throw new AppError(
      409,
      "LAST_SPEAKER_REQUIRED",
      "A proposal must retain at least one speaker. Add another speaker or withdraw the proposal instead.",
    );
}
