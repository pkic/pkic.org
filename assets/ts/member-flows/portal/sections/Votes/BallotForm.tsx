/**
 * Casting a ballot: a candidate list for an election, a choice of motions
 * otherwise.
 *
 * The candidate radios are a real group now — a fieldset with a legend — so
 * they are announced as one choice rather than as loose radios, and each one
 * carries all three parts of the check block. `pk-check` on the label alone
 * renders the operating system's own control, which no gate can see.
 */
import { useState } from "preact/hooks";
import type { z } from "zod";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Radio } from "../../../../ui/Checkbox";
// The check block's three classes are written here rather than reached
// through `ui/Field`, so this module pulls the stylesheet into its own chunk.
import "../../../../ui/Field.css";
import { fmt, toast } from "../../ui";
import type { MemberVote } from "../../types";
import { ballotChoiceLabel, MOTION_CHOICES } from "./shared";
import { recordedMemberBallotSchema, submitBallotResponseSchema } from "../../../../../shared/schemas/votes";

type RecordedMemberBallot = z.infer<typeof recordedMemberBallotSchema>;

/** A choice in words: the motion's label, or the candidate's name in an election. */
function choiceLabel(vote: MemberVote, choice: string): string {
  return vote.candidates?.find((candidate) => candidate.id === choice)?.candidateName ?? ballotChoiceLabel(choice);
}

/**
 * What the Member's ballot says now and who cast it. Any representative may
 * replace it, so every one of them sees it before choosing.
 */
function RecordedBallot({ vote, recorded }: { vote: MemberVote; recorded: RecordedMemberBallot }) {
  return (
    <p class="pk-small">
      Recorded: <span class="pk-strong">{choiceLabel(vote, recorded.choice)}</span>, cast by{" "}
      {recorded.castByYou ? "you" : recorded.castByName} on {fmt(recorded.castAt)}
    </p>
  );
}

export function BallotForm({
  vote,
  memberId,
  organizationName,
  recorded = null,
  hasCastBallot = false,
  endpoint,
  onCast,
}: {
  vote: MemberVote;
  memberId?: string;
  /** The Member a per-Member ballot belongs to, named in the replace confirmation. */
  organizationName?: string;
  /** The Member's recorded ballot, for a per-Member vote. */
  recorded?: RecordedMemberBallot | null;
  hasCastBallot?: boolean;
  endpoint: string;
  onCast: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<string>("");
  const [error, setError] = useState<Error | null>(null);
  // Which choice is in flight, not merely that something is: three motion
  // buttons all showing a spinner says nothing about which one was pressed.
  const [pending, setPending] = useState<string | null>(null);
  const submitting = pending !== null;

  /** Replacing a recorded Member ballot is a decision of its own, named before it is made. */
  async function confirmReplacement(selected: string): Promise<boolean> {
    if (!recorded) return true;
    const owner = organizationName ?? "your organization";
    return confirmAction({
      title: `Change ${owner}'s ballot from ${choiceLabel(vote, recorded.choice)} to ${choiceLabel(vote, selected)}?`,
      body: recorded.castByYou ? undefined : `${recorded.castByName} cast the recorded ballot.`,
      consequences: [`${owner} has one ballot; it becomes ${choiceLabel(vote, selected)}.`],
      confirmLabel: "Change ballot",
      tone: "primary",
    });
  }

  async function submit(selected: string): Promise<void> {
    if (recorded?.choice === selected) return;
    if (!(await confirmReplacement(selected))) return;
    setPending(selected);
    setError(null);
    try {
      await postJson(
        endpoint,
        {
          choice: selected,
          ...(memberId ? { memberId, replacesBallotCastAt: recorded?.castAt ?? null } : {}),
        },
        submitBallotResponseSchema,
      );
      toast(hasCastBallot ? "Ballot updated" : "Ballot cast", "success");
      await onCast();
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Could not cast your ballot."));
    } finally {
      setPending(null);
    }
  }

  if (vote.voteType === "election") {
    const standing = (vote.candidates ?? []).filter((c) => c.eliminatedRound === null);
    return (
      <div class="pk-stack">
        <ErrorAlert error={error} />
        {recorded && <RecordedBallot vote={vote} recorded={recorded} />}
        <fieldset class="pk-fieldset pk-stack pk-stack--snug" disabled={submitting}>
          <legend class="pk-strong">Candidates</legend>
          {standing.map((c) => (
            <Radio
              key={c.id}
              name={`ballot-${vote.id}-${memberId ?? "person"}`}
              checked={(choice || recorded?.choice) === c.id}
              onChange={() => setChoice(c.id)}
              label={c.candidateName}
              hint={c.candidateBio}
            />
          ))}
        </fieldset>
        <div class="pk-cluster">
          <Button
            variant="primary"
            loading={submitting}
            disabled={!choice || choice === recorded?.choice || submitting}
            onClick={() => void submit(choice)}
          >
            {submitting ? "Saving…" : hasCastBallot ? "Update ballot" : "Cast ballot"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div class="pk-stack">
      <ErrorAlert error={error} />
      {recorded && <RecordedBallot vote={vote} recorded={recorded} />}
      <div class="pk-cluster" role="group" aria-label={hasCastBallot ? "Update your ballot" : "Cast your ballot"}>
        {MOTION_CHOICES.map((opt) => (
          <Button
            key={opt.value}
            // The recorded choice reads as the selected one, to a sighted reader and a screen reader alike.
            variant={recorded?.choice === opt.value ? "primary" : "secondary"}
            aria-pressed={recorded ? recorded.choice === opt.value : undefined}
            loading={pending === opt.value}
            disabled={submitting}
            onClick={() => void submit(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
