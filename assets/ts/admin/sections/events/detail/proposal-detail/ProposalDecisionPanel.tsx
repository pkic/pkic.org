import { proposalDecisionPreviewResponseSchema } from "../../../../../../shared/schemas/proposal-decisions";
import { finalizeProposalResponseSchema } from "../../../../../../shared/schemas/proposal-management";
import { ProposalDecisionPanel as SharedProposalDecisionPanel } from "../../../../../components/proposals/ProposalDecisionPanel";
import { api } from "../../../../api";
import { fmt, toast } from "../../../../ui";
import type { ProposalDetailRecord } from "./model";

/** Admin transport adapter for the shared proposal final-decision workflow. */
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
        api(
          `/api/v1/admin/proposals/${encodeURIComponent(proposalId)}/finalize-preview`,
          proposalDecisionPreviewResponseSchema,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        )
      }
      onFinalize={async (input) => {
        await api(
          `/api/v1/admin/proposals/${encodeURIComponent(proposalId)}/finalize`,
          finalizeProposalResponseSchema,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        );
      }}
      onFinalized={onSaved}
      formatDate={fmt}
      notify={toast}
    />
  );
}
