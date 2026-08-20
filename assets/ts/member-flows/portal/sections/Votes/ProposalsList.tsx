import { useCallback, useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { listProposalsResponseSchema } from "../../../../../shared/schemas/votes";
import { getJson, ApiClientError } from "../../../../shared/api-client";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { useApiPage } from "../../../../hooks/useApiPage";
import type { MyWorkingGroupMembership } from "../../types";
import { isVotingCategory } from "./shared";
import { ProposalForm } from "./ProposalForm";
import { ProposalCard } from "./ProposalCard";

export function ProposalsList({ wgNames }: { wgNames: Map<string, string> }) {
  const proposalsPage = useApiPage<z.infer<typeof listProposalsResponseSchema>>(
    "/api/v1/portal/vote-proposals",
    {},
    listProposalsResponseSchema,
  );
  const [myWorkingGroups, setMyWorkingGroups] = useState<MyWorkingGroupMembership[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reloadMemberships = useCallback(async () => {
    try {
      const membershipsData = await getJson<{ workingGroups: MyWorkingGroupMembership[] }>("/api/v1/me/working-groups");
      setMyWorkingGroups(membershipsData.workingGroups);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load proposals.");
    }
  }, []);

  useEffect(() => {
    void reloadMemberships();
  }, [reloadMemberships]);

  const pageError = proposalsPage.error;
  if (error || pageError) {
    return (
      <ErrorAlert error={error ?? (pageError instanceof Error ? pageError.message : "Could not load proposals.")} />
    );
  }
  if (!proposalsPage.data) return <Spinner />;

  const proposals = proposalsPage.data.proposals;

  return (
    <div class="d-flex flex-column gap-3 content-width-reading">
      {isVotingCategory() && <ProposalForm myWorkingGroups={myWorkingGroups} onCreated={proposalsPage.reload} />}
      {proposals.length === 0 ? (
        <p class="text-muted">No proposals are currently open for endorsement.</p>
      ) : (
        proposals.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} wgNames={wgNames} onChanged={proposalsPage.reload} />
        ))
      )}
      {proposalsPage.pagerProps && <Pager {...proposalsPage.pagerProps} />}
    </div>
  );
}
