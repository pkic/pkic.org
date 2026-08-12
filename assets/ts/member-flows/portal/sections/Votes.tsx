/**
 * Votes — ballot casting, results viewing, proposal submission/endorsement.
 * Two tabs: "Votes" (every vote visible to the
 * caller, per `listVisibleVotesForMember` — public + every forum vote +
 * every WG vote for a WG the member belongs to) and "Proposals" (the
 * CA/Browser-Forum-style endorsement path). No shell or
 * backend changes needed — both endpoint groups were already fully live
 * and tested, this is a pure frontend build.
 *
 * H-category members can see everything here but the backend rejects
 * every ballot/proposal/endorsement path for them with no exceptions,
 * this component mirrors that client-side only to avoid a
 * pointless round trip, never as the actual gate.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, postJson, deleteJson, ApiClientError } from "../../../shared/api-client";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { profile as profileSignal } from "../state";
import { toast, fmt, formatStageLabel } from "../ui";
import type {
  PortalVote,
  VoteCandidate,
  VoteProposal,
  VoteType,
  VoteScopeType,
  ElectionVoteResult,
  MotionVoteResult,
  WorkingGroupSummary,
  MyWorkingGroupMembership,
} from "../types";

const MOTION_CHOICES: { value: "in_favor" | "opposed" | "abstain"; label: string }[] = [
  { value: "in_favor", label: "In favor" },
  { value: "opposed", label: "Opposed" },
  { value: "abstain", label: "Abstain" },
];

// Mirrors VOTING_CATEGORIES in _lib/services/member-applications.ts — A–G
// vote, every H-subcategory (H1–H7) does not.
const VOTING_CATEGORIES = new Set(["A", "B", "C", "D", "E", "F", "G"]);

function isVotingCategory(): boolean {
  const category = profileSignal.value?.membershipCategory;
  return Boolean(category && VOTING_CATEGORIES.has(category));
}

function voteStatusBadgeClass(status: string): string {
  switch (status) {
    case "open":
      return "text-bg-success";
    case "scheduled":
      return "text-bg-info";
    case "cancelled":
      return "text-bg-danger";
    default:
      return "text-bg-secondary";
  }
}

function proposalStatusBadgeClass(status: string): string {
  switch (status) {
    case "open_for_endorsement":
      return "text-bg-info";
    case "converted_to_vote":
      return "text-bg-success";
    case "rejected":
      return "text-bg-danger";
    default:
      return "text-bg-secondary";
  }
}

function scopeBadgeLabel(scopeType: VoteScopeType, scopeId: string | null, wgNames: Map<string, string>): string {
  if (scopeType === "forum") return "Forum";
  return scopeId ? (wgNames.get(scopeId) ?? "Working Group") : "Working Group";
}

function isElectionResult(result: MotionVoteResult | ElectionVoteResult): result is ElectionVoteResult {
  return "rounds" in result;
}

function MotionResultView({ result }: { result: MotionVoteResult }) {
  return (
    <div>
      <span class={`badge me-2 ${result.outcome === "passed" ? "text-bg-success" : "text-bg-danger"}`}>
        {result.outcome === "passed" ? "Passed" : "Failed"}
      </span>
      <span class="text-muted small">
        {result.counts.in_favor} in favor · {result.counts.opposed} opposed · {result.counts.abstain} abstained (
        {result.totalBallots} ballots cast)
      </span>
    </div>
  );
}

function ElectionResultView({ result, candidates }: { result: ElectionVoteResult; candidates: VoteCandidate[] }) {
  const nameOf = useCallback((id: string) => candidates.find((c) => c.id === id)?.candidateName ?? id, [candidates]);
  const winner = result.winnerCandidateId ? nameOf(result.winnerCandidateId) : null;

  return (
    <div>
      {winner && (
        <p class="mb-2">
          <span class="badge text-bg-success me-2">Elected</span>
          <span class="fw-semibold">{winner}</span>
        </p>
      )}
      <div class="d-flex flex-column gap-2">
        {result.rounds.map((round) => (
          <div key={round.round} class="small">
            <div class="text-muted">Round {round.round}</div>
            <ul class="mb-0">
              {Object.entries(round.counts).map(([candidateId, count]) => (
                <li key={candidateId}>
                  {nameOf(candidateId)}: {count}
                  {round.eliminatedCandidateIds.includes(candidateId) && <span class="text-muted"> (eliminated)</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function BallotForm({ vote, onCast }: { vote: PortalVote; onCast: () => Promise<void> }) {
  const [choice, setChoice] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(selected: string): Promise<void> {
    setSubmitting(true);
    try {
      await postJson(`/api/v1/portal/votes/${vote.id}/ballots`, { choice: selected });
      toast("Ballot cast", "success");
      await onCast();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not cast your ballot.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (vote.voteType === "election") {
    const standing = (vote.candidates ?? []).filter((c) => c.eliminatedRound === null);
    return (
      <div>
        <div class="d-flex flex-column gap-2 mb-3">
          {standing.map((c) => (
            <label key={c.id} class="list-group-item d-flex align-items-start gap-2">
              <input
                type="radio"
                class="form-check-input mt-1"
                name={`ballot-${vote.id}`}
                checked={choice === c.id}
                disabled={submitting}
                onChange={() => setChoice(c.id)}
              />
              <span>
                <span class="fw-semibold d-block">{c.candidateName}</span>
                {c.candidateBio && <span class="text-muted small">{c.candidateBio}</span>}
              </span>
            </label>
          ))}
        </div>
        <button
          type="button"
          class="btn btn-sm btn-success"
          disabled={!choice || submitting}
          onClick={() => void submit(choice)}
        >
          {submitting ? "Casting…" : "Cast ballot"}
        </button>
      </div>
    );
  }

  return (
    <div class="d-flex gap-2">
      {MOTION_CHOICES.map((opt) => (
        <button
          key={opt.value}
          type="button"
          class="btn btn-sm btn-outline-primary"
          disabled={submitting}
          onClick={() => void submit(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function VoteCard({
  vote,
  wgNames,
  onChanged,
}: {
  vote: PortalVote;
  wgNames: Map<string, string>;
  onChanged: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold">{vote.title}</span>
              <span class={`badge ${voteStatusBadgeClass(vote.status)}`}>{formatStageLabel(vote.status)}</span>
              <span class="badge text-bg-light border">{formatStageLabel(vote.voteType)}</span>
              <span class="badge text-bg-light border">{scopeBadgeLabel(vote.scopeType, vote.scopeId, wgNames)}</span>
              {vote.hasCastBallot && <span class="badge text-bg-primary">You voted</span>}
            </div>
            <p class="text-muted small mb-0 mt-1">
              {vote.status === "open"
                ? `Closes ${fmt(vote.closesAt)}`
                : vote.status === "scheduled"
                  ? `Opens ${fmt(vote.opensAt)}`
                  : `Closed ${fmt(vote.closesAt)}`}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary flex-shrink-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide" : "Details"}
          </button>
        </div>

        {expanded && (
          <div class="mt-3 pt-3 border-top">
            {vote.description && <p class="mb-3">{vote.description}</p>}
            {vote.eligibleCategories && vote.eligibleCategories.length > 0 && (
              <p class="text-muted small">Eligible categories: {vote.eligibleCategories.join(", ")}</p>
            )}

            {vote.status === "open" &&
              (!isVotingCategory() ? (
                <p class="text-muted small mb-0">
                  Category H members don't cast ballots — results will be visible here once this vote closes.
                </p>
              ) : vote.hasCastBallot ? (
                <p class="text-muted small mb-0">You've cast your ballot for this round.</p>
              ) : vote.canCastBallot ? (
                <BallotForm vote={vote} onCast={onChanged} />
              ) : (
                <p class="text-muted small mb-0">
                  {vote.scopeType === "forum"
                    ? "Only your organization's voting delegate may cast this ballot."
                    : "Only members of this working group may cast a ballot."}
                </p>
              ))}

            {vote.status === "scheduled" && <p class="text-muted small mb-0">Voting hasn't opened yet.</p>}

            {vote.status === "closed" &&
              (vote.result ? (
                isElectionResult(vote.result) ? (
                  <ElectionResultView result={vote.result} candidates={vote.candidates ?? []} />
                ) : (
                  <MotionResultView result={vote.result} />
                )
              ) : (
                <p class="text-muted small mb-0">No result recorded.</p>
              ))}

            {vote.status === "cancelled" && <p class="text-muted small mb-0">This vote was cancelled.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function VotesList({ wgNames }: { wgNames: Map<string, string> }) {
  const [votes, setVotes] = useState<PortalVote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await getJson<{ votes: PortalVote[] }>("/api/v1/portal/votes");
      setVotes(data.votes);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load votes.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <ErrorAlert error={error} />;
  if (!votes) return <Spinner />;
  if (votes.length === 0) return <p class="text-muted">No votes are visible to you right now.</p>;

  const open = votes.filter((v) => v.status === "open");
  const upcoming = votes.filter((v) => v.status === "scheduled");
  const closed = votes.filter((v) => v.status === "closed" || v.status === "cancelled");

  const groups: { label: string; items: PortalVote[] }[] = [
    { label: "Open for voting", items: open },
    { label: "Upcoming", items: upcoming },
    { label: "Closed", items: closed },
  ];

  return (
    <div class="d-flex flex-column gap-4" style="max-width: 800px;">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.label}>
            <h3 class="h6 text-muted">{g.label}</h3>
            <div class="d-flex flex-column gap-3">
              {g.items.map((v) => (
                <VoteCard key={v.id} vote={v} wgNames={wgNames} onChanged={reload} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function ProposalForm({
  myWorkingGroups,
  onCreated,
}: {
  myWorkingGroups: MyWorkingGroupMembership[];
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteType, setVoteType] = useState<VoteType>("motion");
  const [scopeType, setScopeType] = useState<VoteScopeType>("forum");
  const [scopeId, setScopeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    if (scopeType === "working_group" && !scopeId) {
      setError("Choose a working group.");
      return;
    }
    setSubmitting(true);
    try {
      await postJson("/api/v1/portal/vote-proposals", {
        title: title.trim(),
        description: description.trim(),
        voteType,
        scopeType,
        scopeId: scopeType === "working_group" ? scopeId : null,
      });
      toast("Proposal submitted, open for endorsement", "success");
      setTitle("");
      setDescription("");
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not submit your proposal.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Propose a vote</div>
      <div class="card-body">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div class="row g-3">
            <div class="col-12">
              <label class="form-label fw-semibold small">Title</label>
              <input
                class="form-control"
                required
                maxLength={300}
                value={title}
                onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                disabled={submitting}
              />
            </div>
            <div class="col-12">
              <label class="form-label fw-semibold small">Description</label>
              <textarea
                class="form-control"
                rows={3}
                required
                value={description}
                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                disabled={submitting}
              />
            </div>
            <div class="col-sm-6">
              <label class="form-label fw-semibold small">Type</label>
              <select
                class="form-select"
                value={voteType}
                onChange={(e) => setVoteType((e.target as HTMLSelectElement).value as VoteType)}
                disabled={submitting}
              >
                <option value="motion">Motion</option>
                <option value="consultation">Consultation</option>
                <option value="election">Election</option>
              </select>
            </div>
            <div class="col-sm-6">
              <label class="form-label fw-semibold small">Scope</label>
              <select
                class="form-select"
                value={scopeType}
                onChange={(e) => {
                  setScopeType((e.target as HTMLSelectElement).value as VoteScopeType);
                  setScopeId("");
                }}
                disabled={submitting}
              >
                <option value="forum">Forum</option>
                <option value="working_group">Working group</option>
              </select>
            </div>
            {scopeType === "working_group" && (
              <div class="col-12">
                <label class="form-label fw-semibold small">Working group</label>
                <select
                  class="form-select"
                  value={scopeId}
                  onChange={(e) => setScopeId((e.target as HTMLSelectElement).value)}
                  disabled={submitting}
                >
                  <option value="">Choose…</option>
                  {myWorkingGroups.map((wg) => (
                    <option key={wg.workingGroupId} value={wg.workingGroupId}>
                      {wg.name}
                    </option>
                  ))}
                </select>
                {myWorkingGroups.length === 0 && (
                  <div class="form-text">You must be a member of a working group to propose a WG-level vote.</div>
                )}
              </div>
            )}
          </div>

          {error && <ErrorAlert error={error} />}

          <button type="submit" class="btn btn-success mt-3" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit proposal"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  wgNames,
  onChanged,
}: {
  proposal: VoteProposal;
  wgNames: Map<string, string>;
  onChanged: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [endorserUserIds, setEndorserUserIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const isProposer = proposal.proposedByUserId === profileSignal.value?.userId;
  const isOpen = proposal.status === "open_for_endorsement";

  async function fetchEndorsers(): Promise<void> {
    try {
      const data = await getJson<{ endorserUserIds: string[] }>(`/api/v1/portal/vote-proposals/${proposal.id}`);
      setEndorserUserIds(data.endorserUserIds);
    } catch {
      setEndorserUserIds([]);
    }
  }

  async function toggle(): Promise<void> {
    const next = !expanded;
    setExpanded(next);
    if (next && isOpen && endorserUserIds === null) await fetchEndorsers();
  }

  async function endorse(): Promise<void> {
    setBusy(true);
    try {
      await postJson(`/api/v1/portal/vote-proposals/${proposal.id}/endorse`, {});
      toast("Endorsement recorded", "success");
      await Promise.all([fetchEndorsers(), onChanged()]);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not endorse this proposal.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawEndorsement(): Promise<void> {
    setBusy(true);
    try {
      await deleteJson(`/api/v1/portal/vote-proposals/${proposal.id}/endorse`);
      toast("Endorsement withdrawn", "success");
      await Promise.all([fetchEndorsers(), onChanged()]);
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not withdraw your endorsement.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function withdrawProposal(): Promise<void> {
    if (!confirm("Withdraw this proposal?")) return;
    setBusy(true);
    try {
      await deleteJson(`/api/v1/portal/vote-proposals/${proposal.id}`);
      toast("Proposal withdrawn", "success");
      await onChanged();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not withdraw this proposal.", "error");
    } finally {
      setBusy(false);
    }
  }

  const hasEndorsed = Boolean(endorserUserIds?.includes(profileSignal.value?.userId ?? ""));

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold">{proposal.title}</span>
              <span class={`badge ${proposalStatusBadgeClass(proposal.status)}`}>
                {formatStageLabel(proposal.status)}
              </span>
              <span class="badge text-bg-light border">{formatStageLabel(proposal.voteType)}</span>
              <span class="badge text-bg-light border">
                {scopeBadgeLabel(proposal.scopeType, proposal.scopeId, wgNames)}
              </span>
              {isOpen && (
                <span class="badge text-bg-secondary">
                  {proposal.endorsementCount} / {proposal.minEndorsersRequired} endorsements
                </span>
              )}
            </div>
            <p class="text-muted small mb-0 mt-1">Submitted {fmt(proposal.createdAt)}</p>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary flex-shrink-0" onClick={() => void toggle()}>
            {expanded ? "Hide" : "Details"}
          </button>
        </div>

        {expanded && (
          <div class="mt-3 pt-3 border-top">
            <p class="mb-3">{proposal.description}</p>
            {proposal.status === "rejected" && proposal.rejectionReason && (
              <div class="alert alert-danger">{proposal.rejectionReason}</div>
            )}
            {proposal.status === "converted_to_vote" && (
              <p class="text-muted small">This proposal reached its endorsement threshold and is now an active vote.</p>
            )}
            {proposal.status === "withdrawn" && <p class="text-muted small">This proposal was withdrawn.</p>}

            {isOpen && (
              <div class="d-flex align-items-center gap-2 flex-wrap">
                {!isVotingCategory() ? (
                  <span class="text-muted small">Category H members can't endorse proposals.</span>
                ) : endorserUserIds === null ? (
                  <Spinner />
                ) : hasEndorsed ? (
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary"
                    disabled={busy}
                    onClick={() => void withdrawEndorsement()}
                  >
                    {busy ? "Withdrawing…" : "Withdraw endorsement"}
                  </button>
                ) : (
                  <button type="button" class="btn btn-sm btn-success" disabled={busy} onClick={() => void endorse()}>
                    {busy ? "Endorsing…" : "Endorse"}
                  </button>
                )}
                {isProposer && (
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-danger"
                    disabled={busy}
                    onClick={() => void withdrawProposal()}
                  >
                    Withdraw proposal
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalsList({ wgNames }: { wgNames: Map<string, string> }) {
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

export function Votes() {
  const [tab, setTab] = useState<"votes" | "proposals">("votes");
  const [wgNames, setWgNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    getJson<{ workingGroups: WorkingGroupSummary[] }>("/api/v1/working-groups")
      .then((data) => setWgNames(new Map(data.workingGroups.map((wg) => [wg.id, wg.name]))))
      .catch(() => setWgNames(new Map()));
  }, []);

  return (
    <div>
      <ul class="nav nav-tabs mb-3">
        <li class="nav-item">
          <button type="button" class={`nav-link${tab === "votes" ? " active" : ""}`} onClick={() => setTab("votes")}>
            Votes
          </button>
        </li>
        <li class="nav-item">
          <button
            type="button"
            class={`nav-link${tab === "proposals" ? " active" : ""}`}
            onClick={() => setTab("proposals")}
          >
            Proposals
          </button>
        </li>
      </ul>
      {tab === "votes" ? <VotesList wgNames={wgNames} /> : <ProposalsList wgNames={wgNames} />}
    </div>
  );
}
