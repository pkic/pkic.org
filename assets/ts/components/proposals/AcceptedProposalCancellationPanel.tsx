import { useState } from "preact/hooks";
import { formatDateTime } from "../../shared/ui";

export interface CancellableProposal {
  status: string;
  canceled_at: string | null;
  cancellation_comment: string | null;
}

/** A deliberate, auditable cancellation action for an accepted session. */
export function AcceptedProposalCancellationPanel({
  proposal,
  canCancel,
  onCancel,
  onCanceled,
  onError,
}: {
  proposal: CancellableProposal;
  canCancel: boolean;
  onCancel: (comment: string) => Promise<{ notifiedSpeakerCount: number }>;
  onCanceled: (notifiedSpeakerCount: number) => void;
  onError: (error: unknown) => void;
}) {
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  if (proposal.status === "canceled") {
    return (
      <div class="card border-danger mt-3">
        <div class="card-header text-danger fw-semibold">Session canceled</div>
        <div class="card-body">
          {proposal.cancellation_comment && <p class="mb-2 adm-pre-wrap">{proposal.cancellation_comment}</p>}
          {proposal.canceled_at && <div class="small text-muted">Canceled {formatDateTime(proposal.canceled_at)}</div>}
        </div>
      </div>
    );
  }
  if (proposal.status !== "accepted" || !canCancel) return null;

  async function handleCancel(event: Event) {
    event.preventDefault();
    if (!comment.trim() || !confirmed) return;
    setSaving(true);
    try {
      const result = await onCancel(comment.trim());
      onCanceled(result.notifiedSpeakerCount);
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="card border-danger mt-3">
      <div class="card-header text-danger fw-semibold">Cancel accepted session</div>
      <div class="card-body">
        <p class="small text-muted">
          This removes the session from the program, deactivates its speaker capacity, and emails every speaker linked
          to the proposal. The accepted decision remains in the audit history.
        </p>
        <form onSubmit={(event) => void handleCancel(event)}>
          <label class="form-label fw-semibold" for="accepted-proposal-cancellation-comment">
            Comment to speakers <span class="text-danger">*</span>
          </label>
          <textarea
            id="accepted-proposal-cancellation-comment"
            class="form-control mb-3"
            rows={4}
            maxLength={5000}
            required
            value={comment}
            onInput={(event) => setComment((event.target as HTMLTextAreaElement).value)}
            placeholder="Explain why this accepted session is being canceled."
          />
          <div class="form-check mb-3">
            <input
              id="accepted-proposal-cancellation-confirm"
              class="form-check-input"
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed((event.target as HTMLInputElement).checked)}
            />
            <label class="form-check-label" for="accepted-proposal-cancellation-confirm">
              I understand that every speaker linked to this proposal will be notified.
            </label>
          </div>
          <button class="btn btn-danger" type="submit" disabled={saving || !comment.trim() || !confirmed}>
            {saving ? "Canceling…" : "Cancel accepted session"}
          </button>
        </form>
      </div>
    </div>
  );
}
