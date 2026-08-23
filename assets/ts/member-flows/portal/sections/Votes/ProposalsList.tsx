import type { z } from "zod";
import { listProposalsResponseSchema } from "../../../../../shared/schemas/votes";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { useApiPage } from "../../../../hooks/useApiPage";
import { isVotingCategory } from "./shared";
import { ProposalForm } from "./ProposalForm";
import { ProposalCard } from "./ProposalCard";

export function ProposalsList() {
  const proposalsPage = useApiPage<z.infer<typeof listProposalsResponseSchema>>(
    "/api/v1/portal/vote-proposals",
    {},
    listProposalsResponseSchema,
    (data) => data.proposals,
  );
  const pageError = proposalsPage.error;
  if (pageError) {
    return <ErrorAlert error={pageError instanceof Error ? pageError.message : "Could not load proposals."} />;
  }
  if (!proposalsPage.data) return <Spinner />;

  const proposals = proposalsPage.data.proposals;

  return (
    <div class="d-flex flex-column gap-3 content-width-reading">
      {isVotingCategory() && <ProposalForm onCreated={proposalsPage.reload} />}
      {proposals.length === 0 ? (
        <p class="text-muted">No proposals are currently open for endorsement.</p>
      ) : (
        proposals.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} onChanged={proposalsPage.reload} />
        ))
      )}
      {proposalsPage.pagerProps && <Pager {...proposalsPage.pagerProps} />}
    </div>
  );
}
