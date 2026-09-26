import { proposalDecisionPreviewResponseSchema } from "../../../../../../../shared/schemas/proposal-decisions";
import { finalizeProposalResponseSchema } from "../../../../../../../shared/schemas/proposal-management";
import { ProposalDecisionPanel as SharedProposalDecisionPanel } from "../../../../../../components/proposals/ProposalDecisionPanel";
import { postJson } from "../../../../../../shared/api-client";
import { fmt, toast } from "../../../../ui";
import type { ProposalDetailRecord } from "./model";
import { proposalResourcePath } from "./proposal-api";

/** Portal transport adapter for the shared proposal final-decision workflow. */
export function ProposalDecisionPanel({
  proposalId,
  proposal,
  reviewCount,
  minReviewsRequired,
  loading,
  onSaved,
}: {
  proposalId: string;
  proposal: ProposalDetailRecord;
  reviewCount: number;
  minReviewsRequired: number;
  loading: boolean;
  onSaved: () => void;
}) {
  return (
    <SharedProposalDecisionPanel
      proposal={proposal}
      reviewCount={reviewCount}
      minReviewsRequired={minReviewsRequired}
      loading={loading}
      onPreview={(input) =>
        postJson(proposalResourcePath(proposalId, "decisions/previews"), input, proposalDecisionPreviewResponseSchema)
      }
      onFinalize={async (input) => {
        await postJson(proposalResourcePath(proposalId, "decisions"), input, finalizeProposalResponseSchema);
      }}
      onFinalized={onSaved}
      formatDate={fmt}
      notify={toast}
    />
  );
}
