import { useState } from "preact/hooks";
import type { GroupVoteDetail } from "../../../../../shared/schemas/group-votes";
import { groupVoteLifecycleTransitionResponseSchema } from "../../../../../shared/schemas/group-vote-management";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";

interface GroupVoteLifecycleActionsProps {
  groupId: string;
  vote: GroupVoteDetail;
  onChanged: () => Promise<void>;
}

export function GroupVoteLifecycleActions({ groupId, vote, onChanged }: GroupVoteLifecycleActionsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [showCancellation, setShowCancellation] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const endpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/votes/${encodeURIComponent(vote.id)}/transitions`;

  async function transition(body: { transition: "open" | "close" } | { transition: "cancel"; reason: string }) {
    setBusy(true);
    setError(null);
    try {
      await postJson(endpoint, body, groupVoteLifecycleTransitionResponseSchema);
      setShowCancellation(false);
      setCancellationReason("");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update the vote."));
    } finally {
      setBusy(false);
    }
  }

  const canOpen = vote.availableTransitions.includes("open");
  const canClose = vote.availableTransitions.includes("close");
  const canCancel = vote.availableTransitions.includes("cancel");
  if (!canOpen && !canClose && !canCancel) return null;

  async function open(): Promise<void> {
    if (
      !(await confirmAction({
        title: `Open "${vote.title}" now?`,
        body: "Members will be able to cast ballots immediately.",
        consequences: ["The vote moves to open status right away", "Members are notified that voting is open"],
        confirmLabel: "Open vote",
        tone: "primary",
      }))
    )
      return;
    await transition({ transition: "open" });
  }

  async function close(): Promise<void> {
    const isElection = vote.voteType === "election";
    if (
      !(await confirmAction({
        title: `Close and tally "${vote.title}" now?`,
        body: isElection
          ? "This ends the current election round and tallies the ballots cast so far."
          : "This ends voting and tallies the ballots cast so far.",
        consequences: isElection
          ? ["Ballots cast in this round are tallied", "The election may advance to another round"]
          : ["Ballots cast so far are tallied", "Members can no longer cast or change a ballot"],
        confirmLabel: isElection ? "Close current round" : "Close and tally",
        tone: "primary",
      }))
    )
      return;
    await transition({ transition: "close" });
  }

  return (
    <section class="border-bottom pb-3 mb-3" aria-label="Vote lifecycle management">
      <div class="d-flex gap-2 flex-wrap">
        {canOpen && (
          <button type="button" class="btn btn-sm btn-success" disabled={busy} onClick={() => void open()}>
            Open vote now
          </button>
        )}
        {canClose && (
          <button type="button" class="btn btn-sm btn-primary" disabled={busy} onClick={() => void close()}>
            Close current round
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            disabled={busy}
            aria-expanded={showCancellation}
            onClick={() => setShowCancellation((shown) => !shown)}
          >
            Cancel vote
          </button>
        )}
      </div>

      {showCancellation && (
        <form
          class="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void transition({ transition: "cancel", reason: cancellationReason });
          }}
        >
          <label class="form-label fw-semibold" for={`vote-${vote.id}-cancellation-reason`}>
            Cancellation reason
          </label>
          <textarea
            id={`vote-${vote.id}-cancellation-reason`}
            class="form-control"
            rows={3}
            maxLength={1000}
            required
            disabled={busy}
            value={cancellationReason}
            onInput={(event) => setCancellationReason(event.currentTarget.value)}
          />
          <div class="d-flex gap-2 mt-2">
            <button type="submit" class="btn btn-sm btn-danger" disabled={busy || !cancellationReason.trim()}>
              {busy ? "Cancelling…" : "Confirm cancellation"}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              disabled={busy}
              onClick={() => setShowCancellation(false)}
            >
              Keep vote
            </button>
          </div>
        </form>
      )}

      <div class="mt-3 mb-0">
        <ErrorAlert error={error} />
      </div>
    </section>
  );
}
