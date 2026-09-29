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
import { postJson, ApiClientError } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Radio } from "../../../../ui/Checkbox";
// The check block's three classes are written here rather than reached
// through `ui/Field`, so this module pulls the stylesheet into its own chunk.
import "../../../../ui/Field.css";
import { toast } from "../../ui";
import type { MemberVote } from "../../types";
import { MOTION_CHOICES } from "./shared";
import { submitBallotResponseSchema } from "../../../../../shared/schemas/votes";

export function BallotForm({
  vote,
  memberId,
  hasCastBallot = false,
  endpoint,
  onCast,
}: {
  vote: MemberVote;
  memberId?: string;
  hasCastBallot?: boolean;
  endpoint: string;
  onCast: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<string>("");
  // Which choice is in flight, not merely that something is: three motion
  // buttons all showing a spinner says nothing about which one was pressed.
  const [pending, setPending] = useState<string | null>(null);
  const submitting = pending !== null;

  async function submit(selected: string): Promise<void> {
    setPending(selected);
    try {
      await postJson(endpoint, { choice: selected, ...(memberId ? { memberId } : {}) }, submitBallotResponseSchema);
      toast(hasCastBallot ? "Ballot updated" : "Ballot cast", "success");
      await onCast();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not cast your ballot.", "error");
    } finally {
      setPending(null);
    }
  }

  if (vote.voteType === "election") {
    const standing = (vote.candidates ?? []).filter((c) => c.eliminatedRound === null);
    return (
      <div class="pk-stack">
        <fieldset class="pk-fieldset pk-stack pk-stack--snug" disabled={submitting}>
          <legend class="pk-strong">Candidates</legend>
          {standing.map((c) => (
            <Radio
              key={c.id}
              name={`ballot-${vote.id}-${memberId ?? "person"}`}
              checked={choice === c.id}
              onChange={() => setChoice(c.id)}
              label={c.candidateName}
              hint={c.candidateBio}
            />
          ))}
        </fieldset>
        <div class="pk-cluster">
          <Button
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={!choice || submitting}
            onClick={() => void submit(choice)}
          >
            {submitting ? "Saving…" : hasCastBallot ? "Update ballot" : "Cast ballot"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div class="pk-cluster" role="group" aria-label={hasCastBallot ? "Update your ballot" : "Cast your ballot"}>
      {MOTION_CHOICES.map((opt) => (
        <Button
          key={opt.value}
          variant="secondary"
          size="sm"
          loading={pending === opt.value}
          disabled={submitting}
          onClick={() => void submit(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
