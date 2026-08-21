import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { fmt } from "../../ui";
import type { AdminWorkingGroupSummary } from "../../types";
import { statusBadge } from "./shared";
import { CreateVoteForm } from "./CreateVoteForm";
import { VoteDetail } from "./VoteDetail";
import { getAdminWorkingGroupCatalogue } from "../../services/catalogues";
import { adminVotesListResponseSchema } from "../../../../shared/schemas/votes-admin";
import { useApiPage } from "../../../hooks/useApiPage";
import { Pager } from "../../../components/Pager";

export function VotesTab() {
  const [workingGroups, setWorkingGroups] = useState<AdminWorkingGroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const listing = useApiPage("/api/v1/admin/votes", { sort: "-created_at" }, adminVotesListResponseSchema);

  const loadCatalogue = useCallback(async () => {
    setCatalogueLoading(true);
    setCatalogueError(null);
    try {
      setWorkingGroups(await getAdminWorkingGroupCatalogue());
    } catch (e) {
      setCatalogueError((e as Error).message);
    } finally {
      setCatalogueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  const votes = listing.data?.votes ?? [];

  const selected = votes.find((v) => v.id === selectedId) ?? null;

  if (catalogueLoading || listing.loading) return <Spinner />;
  if (catalogueError) return <ErrorAlert error={catalogueError} />;
  if (listing.error) {
    return <ErrorAlert error={listing.error instanceof Error ? listing.error.message : "Could not load votes."} />;
  }

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
            void listing.reload();
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
          <div class="col-md-7">{selected && <VoteDetail vote={selected} onChanged={listing.reload} />}</div>
        </div>
      )}
      {listing.pagerProps && <Pager {...listing.pagerProps} />}
    </div>
  );
}
