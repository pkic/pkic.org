import { useState, useEffect } from "preact/hooks";
import { api } from "../../api";
import { toast, fmt } from "../../ui";
import type { AdminVoteSummary, AdminVoteBallot } from "../../types";
import { statusBadge } from "./shared";

export function VoteDetail({ vote, onChanged }: { vote: AdminVoteSummary; onChanged: () => void }) {
  const [visibility, setVisibility] = useState(vote.visibility);
  const [detailLevel, setDetailLevel] = useState(vote.publicDetailLevel);
  const [saving, setSaving] = useState(false);
  const [ballots, setBallots] = useState<AdminVoteBallot[] | null>(null);
  const [loadingBallots, setLoadingBallots] = useState(false);

  useEffect(() => {
    setVisibility(vote.visibility);
    setDetailLevel(vote.publicDetailLevel);
    setBallots(null);
  }, [vote.id]);

  async function saveVisibility() {
    setSaving(true);
    try {
      await api(`/api/v1/admin/votes/${vote.id}/visibility`, {
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

  async function loadBallots() {
    setLoadingBallots(true);
    try {
      const data = await api<{ ballots: AdminVoteBallot[] }>(`/api/v1/admin/votes/${vote.id}/ballots`);
      setBallots(data.ballots);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoadingBallots(false);
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

        <button type="button" class="btn btn-outline-secondary btn-sm" disabled={loadingBallots} onClick={loadBallots}>
          {ballots ? "Refresh ballots" : "Load ballots"}
        </button>

        {ballots && (
          <div class="table-responsive mt-2">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Voter</th>
                  <th>Organization</th>
                  <th>Choice</th>
                  <th>Round</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {ballots.length === 0 && (
                  <tr>
                    <td colSpan={5} class="text-muted">
                      No ballots yet.
                    </td>
                  </tr>
                )}
                {ballots.map((b) => (
                  <tr key={b.id}>
                    <td class="small">{b.userId}</td>
                    <td class="small">{b.organizationId ?? "—"}</td>
                    <td class="small">{b.choice}</td>
                    <td class="small">{b.round}</td>
                    <td class="small">{fmt(b.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
