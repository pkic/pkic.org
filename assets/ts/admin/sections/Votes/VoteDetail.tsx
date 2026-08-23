import { useState, useEffect } from "preact/hooks";
import {
  adminVoteBallotsListResponseSchema,
  adminVoteMutationResponseSchema,
} from "../../../../shared/schemas/votes-admin";
import { api } from "../../api";
import { toast, fmt } from "../../ui";
import type { AdminVoteSummary } from "../../types";
import { ApiDataTable } from "../../components/ApiDataTable";
import { statusBadge } from "./shared";

export function VoteDetail({ vote, onChanged }: { vote: AdminVoteSummary; onChanged: () => void }) {
  const [visibility, setVisibility] = useState(vote.visibility);
  const [detailLevel, setDetailLevel] = useState(vote.publicDetailLevel);
  const [saving, setSaving] = useState(false);
  const [ballotsLoaded, setBallotsLoaded] = useState(false);

  useEffect(() => {
    setVisibility(vote.visibility);
    setDetailLevel(vote.publicDetailLevel);
    setBallotsLoaded(false);
  }, [vote.id]);

  async function saveVisibility() {
    setSaving(true);
    try {
      await api(`/api/v1/admin/votes/${vote.id}/visibility`, adminVoteMutationResponseSchema, {
        method: "PATCH",
        body: JSON.stringify({ visibility, publicDetailLevel: detailLevel }),
      });
      toast("Visibility updated", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <h6 class="mb-1">{vote.title}</h6>
        <p class="text-muted small mb-2">{vote.description}</p>
        <p class="small mb-3">
          <span class={`badge ${statusBadge(vote.status)} me-1 text-capitalize`}>{vote.status}</span>
          <span class="badge text-bg-light me-1 text-capitalize">{vote.voteType}</span>
          <span class="badge text-bg-light me-1 text-capitalize">{vote.scopeType.replace("_", " ")}</span>
          <span class="text-muted">
            Round {vote.currentRound} · Closes {fmt(vote.closesAt)}
          </span>
        </p>

        {vote.candidates && vote.candidates.length > 0 && (
          <div class="mb-3">
            <div class="small fw-semibold mb-1">Candidates</div>
            <ul class="list-unstyled small mb-0">
              {vote.candidates.map((c) => (
                <li key={c.id}>
                  {c.candidateName}
                  {c.eliminatedRound && <span class="text-muted ms-2">(eliminated round {c.eliminatedRound})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div class="row g-2 align-items-end mb-3">
          <div class="col-sm-4">
            <label class="form-label small">Visibility</label>
            <select
              class="form-select form-select-sm"
              value={visibility}
              onChange={(e) => setVisibility((e.target as HTMLSelectElement).value as typeof visibility)}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </div>
          <div class="col-sm-5">
            <label class="form-label small">Public detail level</label>
            <select
              class="form-select form-select-sm"
              value={detailLevel}
              onChange={(e) => setDetailLevel((e.target as HTMLSelectElement).value as typeof detailLevel)}
            >
              <option value="outcome_only">Outcome only</option>
              <option value="aggregate">Aggregate counts</option>
              <option value="full_breakdown">Full breakdown</option>
            </select>
          </div>
          <div class="col-sm-3">
            <button type="button" class="btn btn-primary btn-sm" disabled={saving} onClick={saveVisibility}>
              Save
            </button>
          </div>
        </div>

        {!ballotsLoaded && (
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick={() => setBallotsLoaded(true)}>
            Load ballots
          </button>
        )}

        {ballotsLoaded && (
          <div class="mt-2">
            <ApiDataTable
              endpoint={`/api/v1/admin/votes/${vote.id}/ballots`}
              responseSchema={adminVoteBallotsListResponseSchema}
              resolve={(response) => response.ballots}
              resolvePage={(response) => response.page}
              paginate
              searchPlaceholder="Search ballots…"
              columns={[
                {
                  header: "Voter",
                  cell: (ballot) => ballot.userId,
                  className: "small",
                  sort: { asc: "userId", desc: "-userId" },
                },
                {
                  header: "Organization",
                  cell: (ballot) => ballot.organizationId ?? "—",
                  className: "small",
                  sort: { asc: "organizationId", desc: "-organizationId" },
                },
                {
                  header: "Choice",
                  cell: (ballot) => ballot.choice,
                  className: "small",
                  sort: { asc: "choice", desc: "-choice" },
                },
                {
                  header: "Round",
                  cell: (ballot) => ballot.round,
                  className: "small",
                  sort: { asc: "round", desc: "-round" },
                },
                {
                  header: "Submitted",
                  cell: (ballot) => fmt(ballot.submittedAt),
                  className: "small",
                  sort: { asc: "submittedAt", desc: "-submittedAt" },
                },
              ]}
              empty="No ballots yet."
              rowKey={(ballot) => ballot.id}
              className="table-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}
