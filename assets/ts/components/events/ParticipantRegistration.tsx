import { useState } from "preact/hooks";
import {
  registrationResendConfirmationSchema,
  okResponseSchema,
  registrationManageReadResponseSchema,
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
  type RegistrationManageReadResponse,
} from "../../../shared/schemas/registration";
import { eventFormsResponseSchema } from "../../../shared/schemas/forms";
import { useData } from "../../hooks/useData";
import { getJson, patchJson, postJson } from "../../shared/api-client";
import { normalizeValidation } from "../../shared/form/validation-map";
import { Spinner } from "../Spinner";
import { Badge } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import type { EventFormsResponse } from "../../shared/types";
import { ParticipantRegistrationDetails } from "./ParticipantRegistrationDetails";
import { ParticipantRegistrationForm, type RegistrationChange } from "./ParticipantRegistrationForm";
import { CopyLinkRow } from "../../shared/widgets/copy-link-row";
import { RegistrationDays } from "./RegistrationDays";

export function ParticipantRegistration({
  registrationId,
  eventId,
  slug,
  focusDay = null,
}: {
  registrationId: string;
  eventId: string;
  slug: string;
  /** A day to open the choices for, when a link such as "Can't make it?" led here. */
  focusDay?: string | null;
}) {
  const endpoint = `/api/v1/registrations/${encodeURIComponent(registrationId)}`;
  const loaded = useData(async () => {
    const [registration, forms] = await Promise.all([
      getJson(endpoint, registrationManageReadResponseSchema),
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/forms/placements/event_registration`,
        eventFormsResponseSchema,
      ),
    ]);
    if (registration.event.id !== eventId) throw new Error("Registration not found for this event.");
    return { registration, forms };
  }, [registrationId, eventId, slug]);
  if (loaded.loading) return <Spinner label="Loading registration…" />;
  if (!loaded.data) return <Alert tone="danger">{loaded.error}</Alert>;
  return (
    <RegistrationRecord
      key={registrationId}
      endpoint={endpoint}
      data={loaded.data.registration}
      forms={loaded.data.forms}
      reload={loaded.reload}
      focusDay={focusDay}
    />
  );
}

/** What the attendee reads after a change, in words rather than a status code. */
function outcomeOf(change: RegistrationChange, emailChanged: boolean): string {
  if (emailChanged) {
    return "Check your new email address to confirm the change. Your registration remains pending until then.";
  }
  if (change.action === "cancel") return "Registration cancelled.";
  return "Registration updated.";
}

function RegistrationRecord({
  endpoint,
  data,
  forms,
  reload,
  focusDay,
}: {
  endpoint: string;
  data: RegistrationManageReadResponse;
  forms: EventFormsResponse;
  reload: () => Promise<void>;
  focusDay: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const status = data.registration.status;
  const cancelled = status === "cancelled";
  const restorable = cancelled && data.registration.cancellation_reason_code !== "unauthorized_registration";

  /** Sends one change and returns to the read view on success; rejects with the refusal. */
  async function save(change: RegistrationChange, outcome?: string): Promise<void> {
    setError("");
    setMessage("");
    const result = await patchJson(
      endpoint,
      registrationManageSchema.parse(change),
      registrationManageUpdateResponseSchema,
    );
    setEditing(false);
    setMessage(result.emailChanged ? outcomeOf(change, true) : (outcome ?? outcomeOf(change, false)));
    await reload();
  }

  /** A read-view command: one request at a time, its refusal said in words. */
  async function run(command: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await command();
    } catch (cause) {
      setError(normalizeValidation(cause).globalMessage);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRegistration(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Cancel your registration?",
      body:
        "Your place at this event is released for someone else. You can restore the registration from this page " +
        "while registration is open, but a released in-person place is not held for you.",
      confirmLabel: "Cancel registration",
      cancelLabel: "Keep registration",
    });
    if (confirmed) await run(() => save({ action: "cancel" }));
  }

  async function resendConfirmation(): Promise<void> {
    await postJson(
      `/api/v1/events/${encodeURIComponent(data.event.slug)}/registrations/resend-confirmation`,
      registrationResendConfirmationSchema.parse({ email: data.user.email }),
      okResponseSchema,
    );
    setMessage("A new confirmation link has been requested. Check your email before continuing.");
  }

  async function saveDays(dayAttendance: Array<{ dayDate: string; attendanceType: string }>): Promise<void> {
    // Leaving no day at all is a cancellation, with its own confirmation.
    if (dayAttendance.length === 0) return cancelRegistration();
    await run(() => save({ action: "update", dayAttendance }, "Your days are updated. Thank you for letting us know."));
  }

  function claimSeats(dayDates: string[]): void {
    void run(() =>
      save(
        {
          action: "update",
          dayAttendance: data.dayAttendance.map(({ dayDate, attendanceType }) => ({ dayDate, attendanceType })),
          claimDayWaitlistOffers: dayDates,
        },
        "The seat is yours. See you there!",
      ),
    );
  }

  return (
    <Panel aria-label="Registration">
      <PanelHeader title="Registration" />
      <PanelBody>
        <div class="pk-stack pk-stack--loose">
          <div class="pk-cluster">
            <Badge status={status} />
            <span>{data.registration.isEmailVerified ? "Email confirmed" : "Email confirmation pending"}</span>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          {message && <Alert tone="ok">{message}</Alert>}
          {cancelled && (
            <Alert>
              This registration is cancelled.
              {restorable
                ? " You can restore it if registration is available."
                : " Contact the organizer to review it."}
            </Alert>
          )}
          {editing ? (
            <ParticipantRegistrationForm data={data} forms={forms} save={save} onDiscard={() => setEditing(false)} />
          ) : (
            <>
              <RecordCommands
                busy={busy}
                restorable={restorable}
                pendingConfirmation={status === "pending_email_confirmation"}
                onRestore={() => void run(() => save({ action: "update" }))}
                onResend={() => void run(resendConfirmation)}
              />
              <RegistrationDays
                data={data}
                busy={busy}
                editable={status === "registered"}
                focusDay={focusDay}
                onSave={(dayAttendance) => void saveDays(dayAttendance)}
                onClaim={claimSeats}
              />
              <section class="pk-stack pk-stack--snug" aria-label="Your details">
                <h3>Your details</h3>
                <ParticipantRegistrationDetails data={data} form={forms.form} daysSummarized />
                {!cancelled && (
                  <div class="pk-cluster">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => {
                        setMessage("");
                        setError("");
                        setEditing(true);
                      }}
                    >
                      Edit details
                    </Button>
                  </div>
                )}
              </section>
              {data.shareUrl && !cancelled && (
                <section class="pk-stack pk-stack--snug" aria-label="Invite a colleague">
                  <h3>Invite a colleague</h3>
                  <CopyLinkRow
                    url={data.shareUrl}
                    label="Your personal invitation link"
                    help="Anyone who registers through it is credited to you."
                  />
                </section>
              )}
              {!cancelled && (
                <section class="pk-stack pk-stack--snug" aria-label="Cancel registration">
                  <h3>Not coming at all?</h3>
                  <p class="pk-small pk-muted">
                    Cancel and your place goes to someone on the waiting list. To skip only one day, change that day
                    above instead.
                  </p>
                  <div class="pk-cluster">
                    <Button variant="danger-quiet" disabled={busy} onClick={() => void cancelRegistration()}>
                      Cancel my registration…
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

/** The commands the registration's current state calls for; nothing when it calls for none. */
function RecordCommands({
  busy,
  restorable,
  pendingConfirmation,
  onRestore,
  onResend,
}: {
  busy: boolean;
  restorable: boolean;
  pendingConfirmation: boolean;
  onRestore: () => void;
  onResend: () => void;
}) {
  if (!restorable && !pendingConfirmation) return null;
  return (
    <div class="pk-cluster">
      {restorable && (
        <Button variant="primary" loading={busy} onClick={onRestore}>
          Restore registration
        </Button>
      )}
      {pendingConfirmation && (
        <Button variant="secondary" loading={busy} onClick={onResend}>
          Resend confirmation email
        </Button>
      )}
    </div>
  );
}
