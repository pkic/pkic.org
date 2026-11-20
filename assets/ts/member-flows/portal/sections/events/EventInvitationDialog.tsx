/**
 * The invitation, asked once when a signed-in invitee opens Home: register
 * now, be reminded in a week, or decline. Declining asks the same short
 * survey the emailed decline page asks, through the same use case. The
 * wording is the event's own; only the action labels are shared copy.
 */
import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  ATTENDEE_DECLINE_COPY,
  ATTENDEE_DECLINE_REASON_LABELS,
  EVENT_INVITATION_ACTIONS,
  eventInvitationWording,
} from "../../../../../shared/event-invitation-copy";
import { eventRegisterRoute } from "../../../../../shared/event-participation-link";
import type { eventsListResponseSchema } from "../../../../../shared/schemas/event-management";
import {
  inviteDeclineResponseSchema,
  inviteReminderPreferenceResponseSchema,
} from "../../../../../shared/schemas/invites";
import { inviteDeclineSchema } from "../../../../../shared/schemas/registration";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../ui/Button";
import { Checkbox, Radio } from "../../../../ui/Checkbox";
import { Dialog } from "../../../../ui/Dialog";
import { Field } from "../../../../ui/Field";
import { Markdown } from "../../../../ui/Markdown";
import { Textarea } from "../../../../ui/TextControl";
import { usePortalHashLocation } from "../../hash-location";
import { formatDateRange } from "../../ui";

type EventRow = z.infer<typeof eventsListResponseSchema>["events"][number];
type ReasonCode = keyof typeof ATTENDEE_DECLINE_REASON_LABELS;

const DECLINE_FORM_ID = "event-invitation-decline";

function invitationPath(event: EventRow, inviteId: string, action: "decline" | "reminders"): string {
  return `/api/v1/events/${encodeURIComponent(event.slug)}/invites/${encodeURIComponent(inviteId)}/${action}`;
}

export function EventInvitationDialog({
  event,
  inviteId,
  onClose,
  onAnswered,
}: {
  event: EventRow;
  inviteId: string;
  /** Closes the dialog for this visit; the invitation stays on its card. */
  onClose: () => void;
  /** The invitation was postponed or declined; the list reloads. */
  onAnswered: () => void;
}) {
  const [step, setStep] = useState<"invitation" | "decline">("invitation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reasonCode, setReasonCode] = useState<ReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [unsubscribeFuture, setUnsubscribeFuture] = useState(false);
  const form = useContractForm(inviteDeclineSchema, {
    reasonCode: reasonCode || undefined,
    reasonNote: reasonNote.trim() ? reasonNote : undefined,
    unsubscribeFuture,
  });
  const wording = eventInvitationWording(event, event.invitationMessage);
  const when = event.startsAt ? formatDateRange(event.startsAt, event.endsAt, event.timezone) : null;

  async function postpone() {
    setBusy(true);
    setError("");
    try {
      await postJson(
        invitationPath(event, inviteId, "reminders"),
        { action: "postpone_7d" },
        inviteReminderPreferenceResponseSchema,
      );
      onAnswered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  async function decline(submitEvent: Event) {
    submitEvent.preventDefault();
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setBusy(true);
    setError("");
    try {
      await postJson(invitationPath(event, inviteId, "decline"), checked.data, inviteDeclineResponseSchema);
      onAnswered();
    } catch (cause) {
      setError(form.refuse(cause));
      setBusy(false);
    }
  }

  if (step === "decline") {
    return (
      <Dialog
        open
        title={ATTENDEE_DECLINE_COPY.heading}
        meta={event.name}
        closeLabel="Close invitation"
        confirmLabel={ATTENDEE_DECLINE_COPY.submit}
        onConfirm={() => undefined}
        onCancel={onClose}
        footerActions={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setStep("invitation")}>
              Back
            </Button>
            <Button variant="primary" type="submit" form={DECLINE_FORM_ID} loading={busy}>
              {ATTENDEE_DECLINE_COPY.submit}
            </Button>
          </>
        }
      >
        <form id={DECLINE_FORM_ID} noValidate class="pk-stack" {...form.handlers} onSubmit={(e) => void decline(e)}>
          <p>{ATTENDEE_DECLINE_COPY.intro}</p>
          <Field {...form.of("reasonCode")} label={ATTENDEE_DECLINE_COPY.reasonLabel} group required>
            {(control) => (
              <div class="pk-stack pk-stack--snug" {...control}>
                {(Object.entries(ATTENDEE_DECLINE_REASON_LABELS) as [ReasonCode, string][]).map(([code, label]) => (
                  <Radio
                    key={code}
                    name="reasonCode"
                    value={code}
                    checked={reasonCode === code}
                    onChange={() => setReasonCode(code)}
                    label={label}
                  />
                ))}
              </div>
            )}
          </Field>
          <Field {...form.of("reasonNote")} label={ATTENDEE_DECLINE_COPY.noteLabel} required={reasonCode === "other"}>
            {(control) => (
              <Textarea
                {...control}
                name="reasonNote"
                rows={3}
                value={reasonNote}
                onInput={(inputEvent) => setReasonNote(inputEvent.currentTarget.value)}
              />
            )}
          </Field>
          <Checkbox
            name="unsubscribeFuture"
            checked={unsubscribeFuture}
            onChange={(changeEvent) => setUnsubscribeFuture(changeEvent.currentTarget.checked)}
            label={ATTENDEE_DECLINE_COPY.unsubscribe}
          />
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      kicker={event.name}
      title={wording.headline}
      meta={when}
      closeLabel="Close invitation"
      confirmLabel={EVENT_INVITATION_ACTIONS.register}
      onConfirm={() => undefined}
      onCancel={onClose}
      footerActions={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => setStep("decline")}>
            {EVENT_INVITATION_ACTIONS.decline}
          </Button>
          <Button variant="ghost" disabled={busy} loading={busy} onClick={() => void postpone()}>
            {EVENT_INVITATION_ACTIONS.later}
          </Button>
          <ButtonLink variant="primary" href={usePortalHashLocation.hrefs(eventRegisterRoute(event.slug))}>
            {EVENT_INVITATION_ACTIONS.register}
          </ButtonLink>
        </>
      }
    >
      {wording.message && <Markdown markdown={wording.message} />}
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
