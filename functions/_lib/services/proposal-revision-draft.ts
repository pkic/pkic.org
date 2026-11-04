import { z } from "zod";
import { proposalTypeSchema } from "../../../assets/shared/schemas/proposal-management";
import { parseJsonSafe } from "../utils/json";
import type { ProposalRecord } from "./proposals";

const proposalRevisionDraftSchema = z.object({
  proposalType: proposalTypeSchema,
  title: z.string(),
  abstract: z.string(),
  detailsJson: z.string().nullable(),
  formPlacementId: z.string().nullable(),
  committeeNotes: z.string().nullable(),
});

export type ProposalRevisionDraft = z.infer<typeof proposalRevisionDraftSchema>;

export function serializeProposalRevisionDraft(draft: ProposalRevisionDraft): string {
  return JSON.stringify(proposalRevisionDraftSchema.parse(draft));
}

/** The proposer's unsubmitted changes; only a proposal awaiting their revision has any. */
export function readProposalRevisionDraft(proposal: ProposalRecord): ProposalRevisionDraft | null {
  if (proposal.status !== "needs-work" || !proposal.revision_draft_json) return null;
  return proposalRevisionDraftSchema.parse(parseJsonSafe(proposal.revision_draft_json, null));
}

/** The proposal as its proposer sees it. Reviewer read models keep using the reviewed columns. */
export function withProposalRevisionDraft(proposal: ProposalRecord): ProposalRecord {
  const draft = readProposalRevisionDraft(proposal);
  if (!draft) return proposal;
  return {
    ...proposal,
    proposal_type: draft.proposalType,
    title: draft.title,
    abstract: draft.abstract,
    details_json: draft.detailsJson,
    form_placement_id: draft.formPlacementId,
    committee_notes: draft.committeeNotes,
  };
}
