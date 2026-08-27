import { useState } from "preact/hooks";
import { cancelAcceptedProposalResponseSchema } from "../../../../../../shared/schemas/proposal-management";
import { api } from "../../../../api";
import { fmt, toast } from "../../../../ui";
import type { ProposalDetailRecord } from "./model";

export function ProposalCancellationPanel({
  proposalId,
  proposal,
  canCancel,
  onSaved,
}: {
  proposalId: string;
  proposal: ProposalDetailRecord;
  canCancel: boolean;
  onSaved: () => void;
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
          {proposal.canceled_at && <div class="small text-muted">Canceled {fmt(proposal.canceled_at)}</div>}
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
      const result = await api(`/api/v1/admin/proposals/${proposalId}/cancel`, cancelAcceptedProposalResponseSchema, {
        method: "POST",
        body: JSON.stringify({ comment: comment.trim() }),
      });
      toast(
        `Accepted proposal canceled; ${result.notifiedSpeakerCount} speaker notification${result.notifiedSpeakerCount === 1 ? "" : "s"} queued`,
        "success",
      );
      onSaved();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="card border-danger mt-3">
      <div class="card-header text-danger fw-semibold">Cancel accepted session</div>
      <div class="card-body">
        <p class="small text-muted">
          This removes the session from the program, deactivates its speaker capacity, and emails every current speaker.
          The accepted decision remains in the audit history.
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
              I understand that all current speakers will be notified.
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
