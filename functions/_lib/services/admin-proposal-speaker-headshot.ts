import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { proposalSpeakerEffectiveHeadshotExpression } from "./proposal-speakers";

export interface ProposalSpeakerHeadshotContext {
  speaker_id: string;
  user_id: string;
  email: string;
  proposal_event_id: string;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  headshot_override_set: number;
  headshot_override_r2_key: string | null;
}

export function adminProposalSpeakerHeadshotUrl(
  appBaseUrl: string,
  proposalId: string,
  userId: string,
  updatedAt: string | null,
): string {
  const url = new URL(
    `/api/v1/admin/proposals/${encodeURIComponent(proposalId)}/speakers/${encodeURIComponent(userId)}/headshot`,
    appBaseUrl,
  );
  if (updatedAt) url.searchParams.set("v", updatedAt);
  return url.toString();
}

export async function getProposalSpeakerHeadshot(
  db: DatabaseLike,
  proposalId: string,
  userId: string,
): Promise<ProposalSpeakerHeadshotContext> {
  const speaker = await first<ProposalSpeakerHeadshotContext>(
    db,
    `SELECT ps.id AS speaker_id, ps.user_id, u.email,
            sp.event_id AS proposal_event_id,
            ${proposalSpeakerEffectiveHeadshotExpression("u", "ps")} AS headshot_r2_key,
            CASE WHEN ps.headshot_override_set = 1 THEN ps.headshot_updated_at ELSE u.headshot_updated_at END AS headshot_updated_at,
            ps.headshot_override_set,
            ps.headshot_r2_key AS headshot_override_r2_key
     FROM session_proposals sp
     JOIN proposal_speakers ps ON ps.proposal_id = sp.id AND ps.user_id = ?
     JOIN users u ON u.id = ps.user_id
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [userId, proposalId],
  );
  if (speaker) return speaker;

  const proposal = await first<{ id: string }>(
    db,
    "SELECT id FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
}

/** @deprecated Use the neutral proposal speaker headshot context. */
export type AdminProposalSpeakerHeadshotContext = ProposalSpeakerHeadshotContext;
/** @deprecated Use the neutral proposal speaker headshot loader. */
export const getAdminProposalSpeakerHeadshot = getProposalSpeakerHeadshot;
