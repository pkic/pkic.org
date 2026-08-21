import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { api } from "../../api";
import { fmt } from "../../ui";
import type { AdminVoteProposalSummary } from "../../types";
import { PROPOSAL_STATUS_TABS } from "./shared";
import { ProposalDetail } from "./ProposalDetail";
import { StatusTabs } from "../../components/StatusTabs";

export function ProposalsTab() {
  const [status, setStatus] = useState<(typeof PROPOSAL_STATUS_TABS)[number]>("open_for_endorsement");
  const [proposals, setProposals] = useState<AdminVoteProposalSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ proposals: AdminVoteProposalSummary[] }>(
        `/api/v1/admin/vote-proposals?status=${status}`,
      );
      setProposals(data.proposals);
      setSelectedId((current) => current ?? data.proposals[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    setSelectedId(null);
    void load();
  }, [load]);

  function handleDecided() {
    setSelectedId(null);
    void load();
  }

  return (
    <div>
      <StatusTabs statuses={PROPOSAL_STATUS_TABS} active={status} onChange={setStatus} />

      {loading && <Spinner />}
      {error && <ErrorAlert error={error} />}
      {!loading && !error && proposals.length === 0 && <p class="text-muted">No proposals in this state.</p>}

      {!loading && !error && proposals.length > 0 && (
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
    </div>
  );
}
