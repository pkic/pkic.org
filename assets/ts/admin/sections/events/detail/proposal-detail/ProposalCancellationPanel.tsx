import { AcceptedProposalCancellationPanel } from "../../../../../components/proposals/AcceptedProposalCancellationPanel";
import { cancelAcceptedProposalResponseSchema } from "../../../../../../shared/schemas/proposal-management";
import { api } from "../../../../api";
import { toast } from "../../../../ui";
import type { ProposalDetailRecord } from "./model";
import { proposalResourcePath } from "./proposal-api";

export function ProposalCancellationPanel({
  proposalId,
  proposal,
  canCancel,
  onSaved,
}: {
  proposalId: string;
  proposal: ProposalDetailRecord;
  canCancel: boolean;
  onSaved: () => void;
}) {
  return (
    <AcceptedProposalCancellationPanel
      proposal={proposal}
      canCancel={canCancel}
      onCancel={async (comment) => {
        const result = await api(
          proposalResourcePath(proposalId, "cancellations"),
          cancelAcceptedProposalResponseSchema,
          {
            method: "POST",
            body: JSON.stringify({ comment }),
          },
        );
        return { notifiedSpeakerCount: result.notifiedSpeakerCount };
      }}
      onCanceled={(notifiedSpeakerCount) => {
        toast(
          `Accepted proposal canceled; ${notifiedSpeakerCount} speaker notification${notifiedSpeakerCount === 1 ? "" : "s"} queued`,
          "success",
        );
        onSaved();
      }}
      onError={(error) => toast((error as Error).message, "error")}
    />
  );
}
