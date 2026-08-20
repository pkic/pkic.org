import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { api } from "../../api";
import { fmt } from "../../ui";
import type { AdminVoteSummary, AdminWorkingGroupSummary } from "../../types";
import { statusBadge } from "./shared";
import { CreateVoteForm } from "./CreateVoteForm";
import { VoteDetail } from "./VoteDetail";
import { getAdminWorkingGroupCatalogue } from "../../services/catalogues";

export function VotesTab() {
  const [votes, setVotes] = useState<AdminVoteSummary[]>([]);
  const [workingGroups, setWorkingGroups] = useState<AdminWorkingGroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [votesData, wgData] = await Promise.all([
        // limit=200 (the list contract's max) — this admin view shows the
        // complete vote history unfiltered, not a paginated table; 200
        // comfortably covers realistic vote volume for a consortium.
        api<{ votes: AdminVoteSummary[] }>("/api/v1/admin/votes?limit=200"),
        getAdminWorkingGroupCatalogue(),
      ]);
      setWorkingGroups(wgData);
      setVotes(votesData.votes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = votes.find((v) => v.id === selectedId) ?? null;

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div>
      <div class="d-flex justify-content-between align-items-center mb-3">
        <p class="text-muted small mb-0">Create and manage votes. Member proposals live under the Proposals tab.</p>
        <button type="button" class="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "Create vote"}
        </button>
      </div>

      {showCreate && (
        <CreateVoteForm
          workingGroups={workingGroups}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}

      {votes.length === 0 && <p class="text-muted">No votes yet.</p>}

      {votes.length > 0 && (
        <div class="row g-3">
          <div class="col-md-5">
            <div class="list-group">
              {votes.map((v) => (
                <button
                  type="button"
                  key={v.id}
                  class={`list-group-item list-group-item-action${selectedId === v.id ? " active" : ""}`}
                  onClick={() => setSelectedId(v.id)}
                >
                  <div class="fw-semibold">{v.title}</div>
                  <div class="small text-muted">
                    <span class={`badge ${statusBadge(v.status)} me-1 text-capitalize`}>{v.status}</span>
                    Closes {fmt(v.closesAt)}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div class="col-md-7">{selected && <VoteDetail vote={selected} onChanged={load} />}</div>
        </div>
      )}
    </div>
  );
}
