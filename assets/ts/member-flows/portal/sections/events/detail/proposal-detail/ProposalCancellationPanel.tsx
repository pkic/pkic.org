import { AcceptedProposalCancellationPanel } from "../../../../../../components/proposals/AcceptedProposalCancellationPanel";
import { cancelAcceptedProposalResponseSchema } from "../../../../../../../shared/schemas/proposal-management";
import { postJson } from "../../../../../../shared/api-client";
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
        const result = await postJson(
          proposalResourcePath(proposalId, "cancellations"),
          { comment },
          cancelAcceptedProposalResponseSchema,
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
