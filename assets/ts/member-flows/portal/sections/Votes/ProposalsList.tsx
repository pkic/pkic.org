import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, ApiClientError } from "../../../../shared/api-client";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import type { VoteProposal, MyWorkingGroupMembership } from "../../types";
import { isVotingCategory } from "./shared";
import { ProposalForm } from "./ProposalForm";
import { ProposalCard } from "./ProposalCard";

export function ProposalsList({ wgNames }: { wgNames: Map<string, string> }) {
  const [proposals, setProposals] = useState<VoteProposal[] | null>(null);
  const [myWorkingGroups, setMyWorkingGroups] = useState<MyWorkingGroupMembership[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [proposalsData, membershipsData] = await Promise.all([
        getJson<{ proposals: VoteProposal[] }>("/api/v1/portal/vote-proposals"),
        getJson<{ workingGroups: MyWorkingGroupMembership[] }>("/api/v1/me/working-groups"),
      ]);
      setProposals(proposalsData.proposals);
      setMyWorkingGroups(membershipsData.workingGroups);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load proposals.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <ErrorAlert error={error} />;
  if (!proposals) return <Spinner />;

  return (
    <div class="d-flex flex-column gap-3" style="max-width: 800px;">
      {isVotingCategory() && <ProposalForm myWorkingGroups={myWorkingGroups} onCreated={reload} />}
      {proposals.length === 0 ? (
        <p class="text-muted">No proposals are currently open for endorsement.</p>
      ) : (
        proposals.map((p) => <ProposalCard key={p.id} proposal={p} wgNames={wgNames} onChanged={reload} />)
      )}
    </div>
  );
}
