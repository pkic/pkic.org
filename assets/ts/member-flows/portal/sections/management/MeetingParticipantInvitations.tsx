/**
 * Sending every participant of the group their own link to this meeting.
 *
 * The link is the occurrence's join page, not a secret minted per person: it
 * opens in the portal, so entering it needs the recipient's own session, and
 * that is what records who actually came (#6). A forwarded link therefore
 * admits nobody — it sends the next reader to their own sign-in.
 *
 * Sending again is a numbered round rather than a repeat, so the panel says
 * which round the last one was and when it went out; a manager deciding
 * whether to send a reminder can see that without opening the audit log.
 */
import { useState } from "preact/hooks";
import {
  eventOccurrenceInvitationsResponseSchema,
  type EventOccurrence,
} from "../../../../../shared/schemas/event-series";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { postJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { fmt, toast } from "../../ui";

export function MeetingParticipantInvitations({
  endpoint,
  occurrence,
  eventName,
  onSent,
}: {
  /** The occurrence's own address; invitations are a collection under it. */
  endpoint: string;
  occurrence: EventOccurrence;
  eventName: string;
  onSent: () => void | Promise<void>;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send(): Promise<void> {
    const confirmed = await confirmAction({
      title: `Send every participant their link to ${eventName}?`,
      body:
        occurrence.invitationsRound > 0
          ? "They have had one before, so this is a reminder — everybody in the group receives it again."
          : "Everybody currently participating in the group receives one.",
      consequences: [
        "Each link opens in the portal and records the person who signs in",
        "People who join the group later are not covered by this round",
      ],
      confirmLabel: "Send join links",
    });
    if (!confirmed) return;

    setSending(true);
    setError("");
    try {
      const { invitations } = await postJson(`${endpoint}/invitations`, {}, eventOccurrenceInvitationsResponseSchema);
      toast(
        `Join links queued for ${String(invitations.recipientCount)} ${
          invitations.recipientCount === 1 ? "participant" : "participants"
        }`,
        "success",
      );
      await onSent();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div class="pk-stack pk-stack--snug">
      <p class="pk-small pk-muted">
        {occurrence.invitationsSentAt
          ? `Round ${String(occurrence.invitationsRound)} went out ${fmt(occurrence.invitationsSentAt)}.`
          : "No join links have been sent for this meeting yet."}
      </p>
      <div class="pk-cluster">
        <Button size="sm" loading={sending} disabled={sending} onClick={() => void send()}>
          {occurrence.invitationsRound > 0 ? "Send join links again" : "Send join links"}
        </Button>
      </div>
      {error && <ErrorAlert error={error} />}
    </div>
  );
}
