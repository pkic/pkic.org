import { useState } from "preact/hooks";
import { formatDateTime } from "../../shared/ui";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import { Textarea } from "../../ui/TextControl";
import "../../ui/Content.css";

export interface CancellableProposal {
  status: string;
  canceled_at: string | null;
  cancellation_comment: string | null;
}

const CONFIRM_ID = "accepted-proposal-cancellation-confirm";

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
      // The heading says "canceled", so the state does not depend on the red
      // border the Bootstrap card used to carry it.
      <Panel class="pk">
        <PanelHeader title="Session canceled" />
        <PanelBody class="pk-stack pk-stack--snug">
          {proposal.cancellation_comment && <p class="pk-answer-pre">{proposal.cancellation_comment}</p>}
          {proposal.canceled_at && <p class="pk-small">Canceled {formatDateTime(proposal.canceled_at)}</p>}
        </PanelBody>
      </Panel>
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
    <Panel class="pk">
      <PanelHeader title="Cancel accepted session" />
      <PanelBody>
        <form class="pk-stack" onSubmit={(event) => void handleCancel(event)}>
          {/* The consequences were grey small print under a red border. They
              are what makes this destructive, so they are stated as a warning
              in words rather than implied by the frame's color. */}
          <Alert tone="warn" title="This cannot be undone from here">
            Canceling removes the session from the program, deactivates its speaker capacity, and emails every speaker
            linked to the proposal. The accepted decision remains in the audit history.
          </Alert>
          <Field label="Comment to speakers" required>
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                maxLength={5000}
                value={comment}
                onInput={(event) => setComment((event.target as HTMLTextAreaElement).value)}
                placeholder="Explain why this accepted session is being canceled."
              />
            )}
          </Field>
          <label class="pk-check" for={CONFIRM_ID}>
            <input
              id={CONFIRM_ID}
              class="pk-check__input"
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed((event.target as HTMLInputElement).checked)}
            />
            <span class="pk-check__label">
              I understand that every speaker linked to this proposal will be notified.
            </span>
          </label>
          <div class="pk-cluster">
            <Button type="submit" variant="danger" loading={saving} disabled={saving || !comment.trim() || !confirmed}>
              {saving ? "Canceling…" : "Cancel accepted session"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
