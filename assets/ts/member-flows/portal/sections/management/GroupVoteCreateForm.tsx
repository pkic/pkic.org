import { useState } from "preact/hooks";
import {
  groupVoteCreateInputSchema,
  groupVoteMutationResponseSchema,
} from "../../../../../shared/schemas/group-vote-management";
import {
  THRESHOLD_TYPES,
  thresholdTypeSchema,
  VOTE_ELECTORATE_MODES,
  VOTE_TIE_BREAK_MODES,
  VOTE_TYPES,
  type VoteTieBreakMode,
  type VoteType,
} from "../../../../../shared/schemas/votes";
import { statusLabel } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postValidated } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput, Textarea } from "../../../../ui/TextControl";

interface CandidateDraft {
  name: string;
  bio: string;
}

/** The fewest candidates an election can be run with. */
const MINIMUM_CANDIDATES = 2;
const MAXIMUM_CANDIDATES = 50;

type ThresholdType = (typeof THRESHOLD_TYPES)[number];

const ELECTORATE_MODE_LABELS: Record<(typeof VOTE_ELECTORATE_MODES)[number], string> = {
  per_member: "One ballot per Member",
  per_person: "One ballot per person",
};

const TIE_BREAK_MODE_LABELS: Record<VoteTieBreakMode, string> = {
  none: "Not approved (default)",
  chair: "The chair's own ballot counts twice",
};

const THRESHOLD_TYPE_LABELS: Record<ThresholdType, string> = {
  simple_majority: "Simple majority",
  supermajority: "Supermajority (two thirds)",
  successive_elimination: "Successive elimination",
};

/**
 * An election's simple majority is a majority between two candidates, which is
 * worth saying at the point where the threshold is chosen.
 */
const ELECTION_THRESHOLD_TYPE_LABELS: Record<ThresholdType, string> = {
  ...THRESHOLD_TYPE_LABELS,
  simple_majority: "Simple majority (two candidates)",
};

/**
 * Neither list is typed out. `validateVoteConfiguration` refuses
 * `supermajority` for an election and `successive_elimination` for anything
 * else, so each offer is the shared vocabulary minus the one value that vote
 * type cannot carry — and a fourth threshold would reach both selects.
 */
const ELECTION_THRESHOLD_TYPES = thresholdTypeSchema.exclude(["supermajority"]).options;
const DELIBERATIVE_THRESHOLD_TYPES = thresholdTypeSchema.exclude(["successive_elimination"]).options;

function thresholdOptions(voteType: VoteType): { value: ThresholdType; label: string }[] {
  const election = voteType === "election";
  const labels = election ? ELECTION_THRESHOLD_TYPE_LABELS : THRESHOLD_TYPE_LABELS;
  return (election ? ELECTION_THRESHOLD_TYPES : DELIBERATIVE_THRESHOLD_TYPES).map((value) => ({
    value,
    label: labels[value],
  }));
}

export function GroupVoteCreateForm({
  groupId,
  onCreated,
  onCancel,
}: {
  groupId: string;
  /** Receives the created vote's id, so a create page can go to the record it just made. */
  onCreated: (createdVoteId: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteType, setVoteType] = useState<VoteType>("motion");
  const [electorateMode, setElectorateMode] = useState<(typeof VOTE_ELECTORATE_MODES)[number]>("per_member");
  const [thresholdType, setThresholdType] = useState<ThresholdType>("simple_majority");
  const [opensAt, setOpensAt] = useState("");
  const [quorumPercent, setQuorumPercent] = useState("");
  const [tieBreakMode, setTieBreakMode] = useState<VoteTieBreakMode>("none");
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
    // The submit button stays focusable while the create is in flight — a
    // disabled control throws a screen-reader user out of the form — so the
    // form itself has to refuse a second submission rather than rely on the
    // button being inert.
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await postValidated(
        `/api/v1/groups/${encodeURIComponent(groupId)}/votes`,
        groupVoteCreateInputSchema,
        {
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
        },
        groupVoteMutationResponseSchema,
      );
      setTitle("");
      setDescription("");
      setOpensAt("");
      setQuorumPercent("");
      setTieBreakMode("none");
      setClosesAt("");
      await onCreated(created.vote.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not create the vote."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="pk pk-stack" aria-label="Create vote" onSubmit={(event) => void submit(event)}>
      <Panel>
        <PanelHeader title="Create vote" headingLevel={2} breadcrumb />
        <PanelBody class="pk-stack">
          <ErrorAlert error={error} />
          {/* One disabled fieldset takes every control out of play while the
              create is in flight, rather than each deciding for itself. The
              submit and cancel controls stay outside it so the button the
              reader just pressed keeps focus instead of being disabled from
              under them. */}
          <fieldset class="pk-fieldset pk-stack" disabled={saving}>
            {/* What is being decided reads at full measure; only the paired
                settings share a row below. */}
            <Field label="Title" required>
              {(control) => (
                <TextInput
                  {...control}
                  maxLength={300}
                  value={title}
                  onInput={(event) => setTitle(event.currentTarget.value)}
                />
              )}
            </Field>
            <Field label="Description">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={10000}
                  value={description}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                />
              )}
            </Field>
            <div class="pk-grid pk-grid--roomy">
              <Field label="Type">
                {(control) => (
                  <Select
                    {...control}
                    value={voteType}
                    onChange={(event) => {
                      const next = event.currentTarget.value as VoteType;
                      setVoteType(next);
                      setThresholdType(thresholdOptions(next)[0].value);
                    }}
                  >
                    {VOTE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {statusLabel(type)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Electorate">
                {(control) => (
                  <Select
                    {...control}
                    value={electorateMode}
                    onChange={(event) =>
                      setElectorateMode(event.currentTarget.value as (typeof VOTE_ELECTORATE_MODES)[number])
                    }
                  >
                    {VOTE_ELECTORATE_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {ELECTORATE_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Threshold">
                {(control) => (
                  <Select
                    {...control}
                    value={thresholdType}
                    onChange={(event) => setThresholdType(event.currentTarget.value as ThresholdType)}
                  >
                    {thresholdOptions(voteType).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Opens at" help="Leave blank to open the vote as soon as it is created.">
                {(control) => (
                  <TextInput
                    {...control}
                    type="datetime-local"
                    value={opensAt}
                    onInput={(event) => setOpensAt(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Closes at" required>
                {(control) => (
                  <TextInput
                    {...control}
                    type="datetime-local"
                    value={closesAt}
                    onInput={(event) => setClosesAt(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                label="Minimum turnout"
                help="A percentage of the eligible members. The bylaws decide a matter by a majority of those who cast a vote, so leave this blank unless this particular vote should also require a minimum turnout."
              >
                {(control) => (
                  <TextInput
                    {...control}
                    type="number"
                    min={1}
                    max={100}
                    placeholder="No minimum"
                    value={quorumPercent}
                    onInput={(event) => setQuorumPercent(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Tied vote">
                {(control) => (
                  <Select
                    {...control}
                    value={tieBreakMode}
                    onChange={(event) => setTieBreakMode(event.currentTarget.value as VoteTieBreakMode)}
                  >
                    {VOTE_TIE_BREAK_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {TIE_BREAK_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {voteType === "election" && (
              <div class="pk-stack">
                <p class="pk-strong">Candidates</p>
                {candidates.map((candidate, index) => (
                  <div class="pk-stack pk-stack--snug" key={index}>
                    <div class="pk-grid pk-grid--roomy">
                      <Field label={`Candidate ${String(index + 1)} name`}>
                        {(control) => (
                          <TextInput
                            {...control}
                            value={candidate.name}
                            onInput={(event) => updateCandidate(index, { name: event.currentTarget.value })}
                          />
                        )}
                      </Field>
                      <Field label={`Candidate ${String(index + 1)} biography`}>
                        {(control) => (
                          <TextInput
                            {...control}
                            value={candidate.bio}
                            onInput={(event) => updateCandidate(index, { bio: event.currentTarget.value })}
                          />
                        )}
                      </Field>
                    </div>
                    <div class="pk-cluster">
                      {/* Named for the row it removes: several identical
                          "Remove" buttons are indistinguishable in a list of
                          controls. */}
                      <Button
                        size="sm"
                        variant="danger-quiet"
                        disabled={candidates.length <= MINIMUM_CANDIDATES}
                        onClick={() =>
                          setCandidates((current) => current.filter((_, candidateIndex) => candidateIndex !== index))
                        }
                      >
                        Remove candidate {index + 1}
                      </Button>
                    </div>
                  </div>
                ))}
                <div class="pk-cluster">
                  <Button
                    size="sm"
                    disabled={candidates.length >= MAXIMUM_CANDIDATES}
                    onClick={() => setCandidates((current) => [...current, { name: "", bio: "" }])}
                  >
                    Add candidate
                  </Button>
                </div>
              </div>
            )}
          </fieldset>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={saving}>
              {saving ? "Creating…" : "Create vote"}
            </Button>
            {onCancel && (
              <Button onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
            )}
          </div>
        </PanelBody>
      </Panel>
    </form>
  );
}
