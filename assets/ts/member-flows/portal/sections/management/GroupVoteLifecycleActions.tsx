import { useState } from "preact/hooks";
import type { GroupVoteDetail } from "../../../../../shared/schemas/group-votes";
import { groupVoteLifecycleTransitionResponseSchema } from "../../../../../shared/schemas/group-vote-management";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Textarea } from "../../../../ui/TextControl";

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
    // Still a named region, and still the design system's rhythm: the rule
    // above it and the `mt-*`/`mb-*` each block carried are one `gap` now.
    <section class="pk pk-stack" aria-label="Vote lifecycle management">
      <div class="pk-cluster">
        {canOpen && (
          // `loading` alongside `disabled`: the spinner and aria-busy say the
          // transition is in flight, and `disabled` still stops a second one.
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => void open()}>
            Open vote now
          </Button>
        )}
        {canClose && (
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => void close()}>
            Close current round
          </Button>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="danger-quiet"
            disabled={busy}
            aria-expanded={showCancellation}
            onClick={() => setShowCancellation((shown) => !shown)}
          >
            Cancel vote
          </Button>
        )}
      </div>

      {showCancellation && (
        <form
          class="pk-stack pk-stack--snug"
          aria-label={`Cancel ${vote.title}`}
          onSubmit={(event) => {
            event.preventDefault();
            void transition({ transition: "cancel", reason: cancellationReason });
          }}
        >
          {/* One `disabled` attribute takes the whole form out of play while
              the cancellation is in flight, the control included. */}
          <fieldset class="pk-fieldset" disabled={busy}>
            <Field label="Cancellation reason" required help="Sent to members with the cancellation notice.">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={1000}
                  value={cancellationReason}
                  onInput={(event) => setCancellationReason(event.currentTarget.value)}
                />
              )}
            </Field>
          </fieldset>
          <div class="pk-cluster">
            <Button
              type="submit"
              size="sm"
              variant="danger"
              loading={busy}
              disabled={busy || !cancellationReason.trim()}
            >
              {busy ? "Cancelling…" : "Confirm cancellation"}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setShowCancellation(false)}>
              Keep vote
            </Button>
          </div>
        </form>
      )}

      <ErrorAlert error={error} />
    </section>
  );
}
