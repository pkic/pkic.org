import { useEffect, useState } from "preact/hooks";
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
import { refusalSentence } from "../../shared/form/validation-map";
import { Spinner } from "../Spinner";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import type { EventFormsResponse } from "../../shared/types";
import { ParticipantRegistrationDetails } from "./ParticipantRegistrationDetails";
import { ParticipantRegistrationForm, type RegistrationChange } from "./ParticipantRegistrationForm";
import { RegistrationDays } from "./RegistrationDays";
import { useDialogQueryState } from "../../hooks/useDialogQueryState";
import { Menu } from "../../ui/Menu";

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
  const [editing, showEditor, closeEditor] = useDialogQueryState("editRegistration");
  const [editorMounted, setEditorMounted] = useState(editing);
  useEffect(() => {
    if (editing) setEditorMounted(true);
  }, [editing]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const status = data.registration.status;
  const cancelled = status === "cancelled";
  const restorable = cancelled && data.registration.cancellation_reason_code !== "unauthorized_registration";

  function editDetails() {
    setMessage("");
    setError("");
    setEditorMounted(true);
    showEditor();
  }

  /** Sends one change and returns to the read view on success; rejects with the refusal. */
  async function save(change: RegistrationChange, outcome?: string): Promise<void> {
    // Giving up every day uses the same explicit cancellation confirmation from either editor.
    if (change.action === "update" && change.dayAttendance?.length === 0) return cancelRegistration();
    setError("");
    setMessage("");
    const result = await patchJson(
      endpoint,
      registrationManageSchema.parse(change),
      registrationManageUpdateResponseSchema,
    );
    await closeEditor();
    setEditorMounted(false);
    setMessage(result.emailChanged ? outcomeOf(change, true) : (outcome ?? outcomeOf(change, false)));
    await reload();
  }

  /** A read-view command: one request at a time, its refusal said in words. */
  async function run(command: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await command();
      return true;
    } catch (cause) {
      setError(refusalSentence(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function cancelRegistration(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Cancel your registration?",
      body:
        "Your place at this event is released for someone else. You can restore the registration from this page " +
        "while registration is open, but a released place is not held for you.",
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

  async function saveDays(dayAttendance: Array<{ dayDate: string; attendanceType: string }>): Promise<boolean> {
    return run(() =>
      save({ action: "update", dayAttendance }, "Your days are updated. Thank you for letting us know."),
    );
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
      {!editing && (
        <PanelHeader
          title="Your details"
          menu={
            !cancelled && (
              <Menu
                label="Registration actions"
                items={[
                  {
                    id: "cancel",
                    label: "Cancel my registration…",
                    danger: true,
                    disabled: busy,
                    onSelect: () => void cancelRegistration(),
                  },
                ]}
              />
            )
          }
        />
      )}
      <PanelBody>
        <div class="pk-stack pk-stack--loose">
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
          {editorMounted && (
            <div hidden={!editing}>
              <ParticipantRegistrationForm
                data={data}
                forms={forms}
                save={save}
                onDiscard={() => {
                  setEditorMounted(false);
                  void closeEditor();
                }}
              />
            </div>
          )}
          {!editing && (
            <>
              <RecordCommands
                busy={busy}
                restorable={restorable}
                pendingConfirmation={status === "pending_email_confirmation"}
                onRestore={() => void run(() => save({ action: "update" }))}
                onResend={() => void run(resendConfirmation)}
              />
              <section class="pk-stack pk-stack--snug" aria-label="Your details">
                <ParticipantRegistrationDetails
                  data={data}
                  form={forms.form}
                  daysSummarized
                  onEditDetails={cancelled ? undefined : editDetails}
                  onIdentityChanged={async () => {
                    await reload();
                  }}
                />
              </section>
              <RegistrationDays
                data={data}
                busy={busy}
                editable={status === "registered"}
                focusDay={focusDay}
                onSave={saveDays}
                onClaim={claimSeats}
              />
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
