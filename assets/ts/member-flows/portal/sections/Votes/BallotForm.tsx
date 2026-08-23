import { useState } from "preact/hooks";
import { postJson, ApiClientError } from "../../../../shared/api-client";
import { toast } from "../../ui";
import type { PortalVote } from "../../types";
import { MOTION_CHOICES } from "./shared";
import { submitBallotResponseSchema } from "../../../../../shared/schemas/votes";

export function BallotForm({ vote, onCast }: { vote: PortalVote; onCast: () => Promise<void> }) {
  const [choice, setChoice] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(selected: string): Promise<void> {
    setSubmitting(true);
    try {
      await postJson(`/api/v1/portal/votes/${vote.id}/ballots`, { choice: selected }, submitBallotResponseSchema);
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
