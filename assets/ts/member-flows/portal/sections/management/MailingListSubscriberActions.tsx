import { useState } from "preact/hooks";
import {
  mailingListPreferenceMutationResponseSchema,
  type MailingListSubscriber,
  type MailingListPreferenceSelection,
} from "../../../../../shared/schemas/mailing-lists";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { RowActions } from "../../../../ui/RowActions";
import { putJson } from "../../../../shared/api-client";

const ACTIONS = [
  { preference: "subscribed", label: "Subscribe", description: "Receive email from this list." },
  {
    preference: "archive_only",
    label: "Turn off email delivery",
    description:
      "Keep list membership without receiving email. Archive and posting access still follow the list’s policy.",
  },
  {
    preference: "inherit",
    label: "Use group default",
    description: "Follow this list’s automatic subscription rules.",
  },
  {
    preference: "unsubscribed",
    label: "Unsubscribe",
    description: "Remove list membership, including access to members-only archives.",
  },
] as const;

/** Confirm per-person changes and allow an explicit rejoin after an external unsubscribe. */
export function MailingListSubscriberActions({
  groupId,
  listId,
  subscriber,
  disabled = false,
  onChanged,
}: {
  groupId: string;
  listId: string;
  subscriber: MailingListSubscriber;
  disabled?: boolean;
  onChanged: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const name =
    [subscriber.user.first_name, subscriber.user.last_name].filter(Boolean).join(" ") || subscriber.user.email;
  /** Save through the shared contract, then reload the server's effective subscription state. */
  async function change(preference: MailingListPreferenceSelection, label: string, description: string) {
    if (
      !(await confirmAction({
        title: `${label}: ${name}?`,
        body: description,
        confirmLabel: label,
        tone: preference === "unsubscribed" ? "danger" : "primary",
      }))
    )
      return;
    setPending(true);
    setError(null);
    try {
      await putJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(listId)}/subscribers/${encodeURIComponent(subscriber.user.id)}`,
        { preference },
        mailingListPreferenceMutationResponseSchema,
      );
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update the subscription preference"));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <RowActions
        subject={name}
        actions={ACTIONS.map(({ preference, label, description }) => ({
          id: preference,
          label,
          disabled:
            disabled ||
            pending ||
            ((subscriber.preference ?? "inherit") === preference &&
              !subscriber.synchronizationError &&
              subscriber.synchronizationStatus !== "failed" &&
              !(subscriber.suppressed && (preference === "subscribed" || preference === "archive_only"))) ||
            (!subscriber.eligible && (preference === "subscribed" || preference === "archive_only")),
          danger: preference === "unsubscribed",
          separatorBefore: preference === "unsubscribed",
          onSelect: () => void change(preference, label, description),
        }))}
      />
      {error && <ErrorAlert error={error} />}
    </>
  );
}
