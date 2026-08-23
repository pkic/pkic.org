import { useState, useEffect } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { fmt } from "../../ui";
import type { AdminVoteProposalSummary } from "../../types";
import { PROPOSAL_STATUS_TABS } from "./shared";
import { ProposalDetail } from "./ProposalDetail";
import { StatusTabs } from "../../components/StatusTabs";
import { adminVoteProposalsListResponseSchema } from "../../../../shared/schemas/votes-admin";
import { useApiPage } from "../../../hooks/useApiPage";
import { Pager } from "../../../components/Pager";

export function ProposalsTab() {
  const [status, setStatus] = useState<(typeof PROPOSAL_STATUS_TABS)[number]>("open_for_endorsement");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listing = useApiPage(
    "/api/v1/admin/vote-proposals",
    { status },
    adminVoteProposalsListResponseSchema,
    (data) => data.proposals,
  );
  const proposals: AdminVoteProposalSummary[] = listing.data?.proposals ?? [];

  useEffect(() => {
    setSelectedId(proposals[0]?.id ?? null);
  }, [status, listing.data]);

  function handleDecided() {
    setSelectedId(null);
    void listing.reload();
  }

  return (
    <div>
      <StatusTabs statuses={PROPOSAL_STATUS_TABS} active={status} onChange={setStatus} />

      {listing.loading && <Spinner />}
      {listing.error && <ErrorAlert error={listing.error} />}
      {!listing.loading && !listing.error && proposals.length === 0 && (
        <p class="text-muted">No proposals in this state.</p>
      )}

      {!listing.loading && !listing.error && proposals.length > 0 && (
        <div class="row g-3">
          <div class="col-md-4">
            <div class="list-group">
              {proposals.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  class={`list-group-item list-group-item-action${selectedId === p.id ? " active" : ""}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div class="fw-semibold">{p.title}</div>
                  <div class="small text-muted">{fmt(p.createdAt)}</div>
                </button>
              ))}
            </div>
          </div>
          <div class="col-md-8">
            {selectedId && <ProposalDetail proposalId={selectedId} onDecided={handleDecided} />}
          </div>
        </div>
      )}
      {listing.pagerProps && <Pager {...listing.pagerProps} />}
    </div>
  );
}
