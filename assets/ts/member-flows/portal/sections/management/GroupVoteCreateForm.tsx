import { useState } from "preact/hooks";
import {
  groupVoteCreateInputSchema,
  groupVoteMutationResponseSchema,
} from "../../../../../shared/schemas/group-vote-management";
import { VOTE_ELECTORATE_MODES, VOTE_TYPES } from "../../../../../shared/schemas/votes";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";

interface CandidateDraft {
  name: string;
  bio: string;
}

function thresholdOptions(voteType: (typeof VOTE_TYPES)[number]) {
  return voteType === "election"
    ? [
        { value: "simple_majority", label: "Simple majority (two candidates)" },
        { value: "successive_elimination", label: "Successive elimination" },
      ]
    : [
        { value: "simple_majority", label: "Simple majority" },
        { value: "supermajority", label: "Supermajority (two thirds)" },
      ];
}

export function GroupVoteCreateForm({ groupId, onCreated }: { groupId: string; onCreated: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteType, setVoteType] = useState<(typeof VOTE_TYPES)[number]>("motion");
  const [electorateMode, setElectorateMode] = useState<(typeof VOTE_ELECTORATE_MODES)[number]>("per_member");
  const [thresholdType, setThresholdType] = useState("simple_majority");
  const [opensAt, setOpensAt] = useState("");
  const [quorumPercent, setQuorumPercent] = useState("");
  const [tieBreakMode, setTieBreakMode] = useState<"none" | "chair">("none");
  const [closesAt, setClosesAt] = useState("");
  const [candidates, setCandidates] = useState<CandidateDraft[]>([
    { name: "", bio: "" },
    { name: "", bio: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  function updateCandidate(index: number, patch: Partial<CandidateDraft>): void {
    setCandidates((current) =>
      current.map((candidate, candidateIndex) => (candidateIndex === index ? { ...candidate, ...patch } : candidate)),
    );
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = groupVoteCreateInputSchema.parse({
        title,
        description: description || undefined,
        voteType,
        electorateMode,
        thresholdType,
        opensAt: opensAt ? new Date(opensAt).toISOString() : undefined,
        quorumPercent: quorumPercent ? Number(quorumPercent) : null,
        tieBreakMode,
        closesAt: new Date(closesAt).toISOString(),
        candidates:
          voteType === "election"
            ? candidates
                .filter((candidate) => candidate.name.trim())
                .map((candidate) => ({ name: candidate.name, bio: candidate.bio || undefined }))
            : undefined,
      });
      await postJson(`/api/v1/groups/${encodeURIComponent(groupId)}/votes`, input, groupVoteMutationResponseSchema);
      setTitle("");
      setDescription("");
      setOpensAt("");
      setQuorumPercent("");
      setTieBreakMode("none");
      setClosesAt("");
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not create the vote."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="border rounded p-3 mb-3" onSubmit={(event) => void submit(event)}>
      <h6>Create vote</h6>
      <ErrorAlert error={error} />
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label" for="group-vote-title">
            Title
          </label>
          <input
            id="group-vote-title"
            class="form-control"
            required
            maxLength={300}
            value={title}
            disabled={saving}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="group-vote-description">
            Description
          </label>
          <input
            id="group-vote-description"
            class="form-control"
            maxLength={10000}
            value={description}
            disabled={saving}
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label" for="group-vote-type">
            Type
          </label>
          <select
            id="group-vote-type"
            class="form-select"
            value={voteType}
            disabled={saving}
            onChange={(event) => {
              const next = event.currentTarget.value as (typeof VOTE_TYPES)[number];
              setVoteType(next);
              setThresholdType(thresholdOptions(next)[0].value);
            }}
          >
            {VOTE_TYPES.map((type) => (
              <option value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label" for="group-vote-electorate">
            Electorate
          </label>
          <select
            id="group-vote-electorate"
            class="form-select"
            value={electorateMode}
            disabled={saving}
            onChange={(event) => setElectorateMode(event.currentTarget.value as (typeof VOTE_ELECTORATE_MODES)[number])}
          >
            <option value="per_member">One ballot per Member</option>
            <option value="per_person">One ballot per person</option>
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label" for="group-vote-threshold">
            Threshold
          </label>
          <select
            id="group-vote-threshold"
            class="form-select"
            value={thresholdType}
            disabled={saving}
            onChange={(event) => setThresholdType(event.currentTarget.value)}
          >
            {thresholdOptions(voteType).map((option) => (
              <option value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div class="col-md-6">
          <label class="form-label" for="group-vote-opens">
            Opens at (blank means now)
          </label>
          <input
            id="group-vote-opens"
            type="datetime-local"
            class="form-control"
            value={opensAt}
            disabled={saving}
            onInput={(event) => setOpensAt(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="group-vote-closes">
            Closes at
          </label>
          <input
            id="group-vote-closes"
            type="datetime-local"
            class="form-control"
            required
            value={closesAt}
            disabled={saving}
            onInput={(event) => setClosesAt(event.currentTarget.value)}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label" for="group-vote-quorum">
            Minimum turnout (blank means none)
          </label>
          <div class="input-group">
            <input
              id="group-vote-quorum"
              type="number"
              min={1}
              max={100}
              class="form-control"
              placeholder="No minimum"
              value={quorumPercent}
              disabled={saving}
              onInput={(event) => setQuorumPercent(event.currentTarget.value)}
            />
            <span class="input-group-text">% of eligible members</span>
          </div>
          <div class="form-text">
            The bylaws decide a matter by majority of those who cast a vote, so leave this blank unless this particular
            vote should also require a minimum turnout.
          </div>
        </div>
        <div class="col-md-6">
          <label class="form-label" for="group-vote-tie-break">
            Tied vote
          </label>
          <select
            id="group-vote-tie-break"
            class="form-select"
            value={tieBreakMode}
            disabled={saving}
            onChange={(event) => setTieBreakMode(event.currentTarget.value as "none" | "chair")}
          >
            <option value="none">Not approved (default)</option>
            <option value="chair">The chair's own ballot counts twice</option>
          </select>
        </div>
        {voteType === "election" && (
          <div class="col-12">
            <div class="fw-semibold mb-2">Candidates</div>
            {candidates.map((candidate, index) => (
              <div class="row g-2 mb-2" key={index}>
                <div class="col-md-4">
                  <input
                    class="form-control"
                    aria-label={`Candidate ${index + 1} name`}
                    placeholder="Name"
                    value={candidate.name}
                    disabled={saving}
                    onInput={(event) => updateCandidate(index, { name: event.currentTarget.value })}
                  />
                </div>
                <div class="col-md-6">
                  <input
                    class="form-control"
                    aria-label={`Candidate ${index + 1} biography`}
                    placeholder="Biography (optional)"
                    value={candidate.bio}
                    disabled={saving}
                    onInput={(event) => updateCandidate(index, { bio: event.currentTarget.value })}
                  />
                </div>
                <div class="col-md-2">
                  <button
                    type="button"
                    class="btn btn-outline-danger"
                    disabled={saving || candidates.length <= 2}
                    onClick={() =>
                      setCandidates((current) => current.filter((_, candidateIndex) => candidateIndex !== index))
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              disabled={saving || candidates.length >= 50}
              onClick={() => setCandidates((current) => [...current, { name: "", bio: "" }])}
            >
              Add candidate
            </button>
          </div>
        )}
      </div>
      <button type="submit" class="btn btn-success mt-3" disabled={saving}>
        {saving ? "Creating…" : "Create vote"}
      </button>
    </form>
  );
}
