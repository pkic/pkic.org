/**
 * Admin → Votes. Two tabs: direct vote creation +
 * management (visibility, ballot audit), and member-proposal moderation
 * (approve bypasses the endorsement count, reject requires a reason and
 * emails the proposer). Mirrors OrganizationContentReviews.tsx's
 * list+detail moderation layout for the Proposals tab.
 */
import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { toast, fmt } from "../ui";
import type { AdminVoteSummary, AdminVoteBallot, AdminVoteProposalSummary, AdminWorkingGroupSummary } from "../types";

const TOP_TABS = ["votes", "proposals"] as const;
type TopTab = (typeof TOP_TABS)[number];

const VOTE_TYPES = ["motion", "consultation", "election"] as const;
const SCOPE_TYPES = ["forum", "working_group"] as const;

function thresholdOptionsFor(voteType: string): { value: string; label: string }[] {
  if (voteType === "election") {
    return [
      { value: "simple_majority", label: "Simple majority (2 candidates)" },
      { value: "successive_elimination", label: "Successive elimination (3+ candidates)" },
    ];
  }
  return [
    { value: "simple_majority", label: "Simple majority" },
    { value: "supermajority", label: "Supermajority (2/3)" },
  ];
}

function statusBadge(status: string): string {
  return (
    { scheduled: "text-bg-light", open: "text-bg-success", closed: "text-bg-secondary", cancelled: "text-bg-danger" }[
      status
    ] ?? "text-bg-light"
  );
}

// ── Votes tab ──────────────────────────────────────────────────────────

interface CandidateDraft {
  name: string;
  bio: string;
}

interface CreateDraft {
  title: string;
  description: string;
  voteType: (typeof VOTE_TYPES)[number];
  scopeType: (typeof SCOPE_TYPES)[number];
  scopeId: string;
  thresholdType: string;
  opensAt: string;
  closesAt: string;
  candidates: CandidateDraft[];
}

function emptyDraft(): CreateDraft {
  return {
    title: "",
    description: "",
    voteType: "motion",
    scopeType: "forum",
    scopeId: "",
    thresholdType: "simple_majority",
    opensAt: "",
    closesAt: "",
    candidates: [
      { name: "", bio: "" },
      { name: "", bio: "" },
    ],
  };
}

function CreateVoteForm({
  workingGroups,
  onCreated,
}: {
  workingGroups: AdminWorkingGroupSummary[];
  onCreated: () => void;
}) {
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  function patch(p: Partial<CreateDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!draft.closesAt) {
      toast("Closes-at is required", "error");
      return;
    }
    setSaving(true);
    try {
      await api("/api/v1/admin/votes", {
        method: "POST",
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim() || undefined,
          voteType: draft.voteType,
          scopeType: draft.scopeType,
          scopeId: draft.scopeType === "working_group" ? draft.scopeId || undefined : undefined,
          thresholdType: draft.thresholdType,
          opensAt: draft.opensAt ? new Date(draft.opensAt).toISOString() : undefined,
          closesAt: new Date(draft.closesAt).toISOString(),
          candidates:
            draft.voteType === "election"
              ? draft.candidates
                  .filter((c) => c.name.trim())
                  .map((c) => ({ name: c.name.trim(), bio: c.bio.trim() || undefined }))
              : undefined,
        }),
      });
      toast("Vote created", "success");
      setDraft(emptyDraft());
      onCreated();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <div class="row g-2">
          <div class="col-sm-6">
            <label class="form-label small">Title</label>
            <input
              class="form-control form-control-sm"
              value={draft.title}
              required
              onInput={(e) => patch({ title: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-sm-6">
            <label class="form-label small">Description</label>
            <input
              class="form-control form-control-sm"
              value={draft.description}
              onInput={(e) => patch({ description: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Vote type</label>
            <select
              class="form-select form-select-sm"
              value={draft.voteType}
              onChange={(e) => {
                const voteType = (e.target as HTMLSelectElement).value as CreateDraft["voteType"];
                patch({ voteType, thresholdType: thresholdOptionsFor(voteType)[0].value });
              }}
            >
              {VOTE_TYPES.map((t) => (
                <option value={t} key={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Scope</label>
            <select
              class="form-select form-select-sm"
              value={draft.scopeType}
              onChange={(e) => patch({ scopeType: (e.target as HTMLSelectElement).value as CreateDraft["scopeType"] })}
            >
              {SCOPE_TYPES.map((t) => (
                <option value={t} key={t}>
                  {t === "forum" ? "Forum (one org/vote)" : "Working group"}
                </option>
              ))}
            </select>
          </div>
          {draft.scopeType === "working_group" && (
            <div class="col-sm-3">
              <label class="form-label small">Working group</label>
              <select
                class="form-select form-select-sm"
                value={draft.scopeId}
                onChange={(e) => patch({ scopeId: (e.target as HTMLSelectElement).value })}
              >
                <option value="">Select…</option>
                {workingGroups.map((wg) => (
                  <option value={wg.id} key={wg.id}>
                    {wg.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div class="col-sm-3">
            <label class="form-label small">Threshold</label>
            <select
              class="form-select form-select-sm"
              value={draft.thresholdType}
              onChange={(e) => patch({ thresholdType: (e.target as HTMLSelectElement).value })}
            >
              {thresholdOptionsFor(draft.voteType).map((o) => (
                <option value={o.value} key={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Opens at (blank = now)</label>
            <input
              type="datetime-local"
              class="form-control form-control-sm"
              value={draft.opensAt}
              onInput={(e) => patch({ opensAt: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Closes at</label>
            <input
              type="datetime-local"
              class="form-control form-control-sm"
              required
              value={draft.closesAt}
              onInput={(e) => patch({ closesAt: (e.target as HTMLInputElement).value })}
            />
          </div>

          {draft.voteType === "election" && (
            <div class="col-12">
              <label class="form-label small">Candidates</label>
              {draft.candidates.map((c, i) => (
                <div class="row g-2 mb-1" key={i}>
                  <div class="col-sm-4">
                    <input
                      class="form-control form-control-sm"
                      placeholder="Name"
                      value={c.name}
                      onInput={(e) => {
                        const next = [...draft.candidates];
                        next[i] = { ...next[i], name: (e.target as HTMLInputElement).value };
                        patch({ candidates: next });
                      }}
                    />
                  </div>
                  <div class="col-sm-6">
                    <input
                      class="form-control form-control-sm"
                      placeholder="Bio (optional)"
                      value={c.bio}
                      onInput={(e) => {
                        const next = [...draft.candidates];
                        next[i] = { ...next[i], bio: (e.target as HTMLInputElement).value };
                        patch({ candidates: next });
                      }}
                    />
                  </div>
                  <div class="col-sm-2">
                    <button
                      type="button"
                      class="btn btn-outline-danger btn-sm"
                      onClick={() => patch({ candidates: draft.candidates.filter((_, idx) => idx !== i) })}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm"
                onClick={() => patch({ candidates: [...draft.candidates, { name: "", bio: "" }] })}
              >
                + Add candidate
              </button>
            </div>
          )}
        </div>

        <button type="submit" class="btn btn-success btn-sm mt-3" disabled={saving}>
          Create vote
        </button>
      </div>
    </form>
  );
}

function VoteDetail({ vote, onChanged }: { vote: AdminVoteSummary; onChanged: () => void }) {
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

function VotesTab() {
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
        api<{ workingGroups: AdminWorkingGroupSummary[] }>("/api/v1/admin/working-groups"),
      ]);
      setWorkingGroups(wgData.workingGroups);
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
        <p class="text-muted small mb-0">
          Create and manage votes. Member proposals live under the Proposals tab.
        </p>
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

// ── Proposals tab ──────────────────────────────────────────────────────

const PROPOSAL_STATUS_TABS = ["open_for_endorsement", "converted_to_vote", "rejected", "withdrawn"] as const;

function ProposalDetail({ proposalId, onDecided }: { proposalId: string; onDecided: () => void }) {
  const [detail, setDetail] = useState<{ proposal: AdminVoteProposalSummary; endorserUserIds: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ proposal: AdminVoteProposalSummary; endorserUserIds: string[] }>(
        `/api/v1/admin/vote-proposals/${proposalId}`,
      );
      setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    setBusy(true);
    try {
      await api(`/api/v1/admin/vote-proposals/${proposalId}/approve`, { method: "POST" });
      toast("Converted to an active vote", "success");
      onDecided();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!reason.trim()) {
      toast("A reason is required to reject", "error");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/admin/vote-proposals/${proposalId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast("Rejected — proposer notified", "success");
      onDecided();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;
  const { proposal, endorserUserIds } = detail;

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <h6 class="mb-1">{proposal.title}</h6>
        <p class="small mb-2" style={{ whiteSpace: "pre-wrap" }}>
          {proposal.description}
        </p>
        <p class="small text-muted mb-3">
          <span class="badge text-bg-light me-1 text-capitalize">{proposal.voteType}</span>
          <span class="badge text-bg-light me-1 text-capitalize">{proposal.scopeType.replace("_", " ")}</span>
          Endorsements: {proposal.endorsementCount} / {proposal.minEndorsersRequired}
        </p>
        {endorserUserIds.length > 0 && <p class="small text-muted mb-3">Endorsers: {endorserUserIds.join(", ")}</p>}

        {proposal.status === "open_for_endorsement" && (
          <>
            <div class="mb-2">
              <label class="form-label small">Rejection reason (required to reject)</label>
              <textarea
                class="form-control"
                rows={2}
                value={reason}
                onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
              />
            </div>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-success btn-sm" disabled={busy} onClick={approve}>
                Approve (bypass endorsements)
              </button>
              <button type="button" class="btn btn-outline-danger btn-sm" disabled={busy} onClick={reject}>
                Reject
              </button>
            </div>
          </>
        )}
        {proposal.status !== "open_for_endorsement" && (
          <p class="small mb-0">
            <span class="badge text-bg-secondary text-capitalize">{proposal.status.replace(/_/g, " ")}</span>
            {proposal.rejectionReason && <span class="text-muted ms-2">{proposal.rejectionReason}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

function ProposalsTab() {
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
      <ul class="nav nav-tabs mb-3">
        {PROPOSAL_STATUS_TABS.map((tab) => (
          <li class="nav-item" key={tab}>
            <button
              type="button"
              class={`nav-link text-capitalize${status === tab ? " active" : ""}`}
              onClick={() => setStatus(tab)}
            >
              {tab.replace(/_/g, " ")}
            </button>
          </li>
        ))}
      </ul>

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

// ── Root ───────────────────────────────────────────────────────────────

export function Votes() {
  const [tab, setTab] = useState<TopTab>("votes");

  return (
    <div>
      <ul class="nav nav-pills mb-3">
        {TOP_TABS.map((t) => (
          <li class="nav-item" key={t}>
            <button
              type="button"
              class={`nav-link text-capitalize${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          </li>
        ))}
      </ul>
      {tab === "votes" ? <VotesTab /> : <ProposalsTab />}
    </div>
  );
}
