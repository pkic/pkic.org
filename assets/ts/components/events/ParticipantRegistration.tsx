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
import { RegistrationDayStatusSummary } from "../RegistrationDayStatusSummary";
import { Spinner } from "../Spinner";
import { Badge } from "../Badge";
import { confirmAction } from "../ConfirmDialog";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Menu } from "../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import type { EventFormsResponse } from "../../shared/types";
import { ParticipantRegistrationDetails } from "./ParticipantRegistrationDetails";
import { ParticipantRegistrationForm, type RegistrationChange } from "./ParticipantRegistrationForm";

export function ParticipantRegistration({
  registrationId,
  eventId,
  slug,
}: {
  registrationId: string;
  eventId: string;
  slug: string;
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
}: {
  endpoint: string;
  data: RegistrationManageReadResponse;
  forms: EventFormsResponse;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const status = data.registration.status;
  const cancelled = status === "cancelled";
  const restorable = cancelled && data.registration.cancellation_reason_code !== "unauthorized_registration";
  const offered = data.dayWaitlist.filter((day) => day.status === "offered").map((day) => day.dayDate);

  /** Sends one change and returns to the read view on success; rejects with the refusal. */
  async function save(change: RegistrationChange): Promise<void> {
    setError("");
    setMessage("");
    const result = await patchJson(
      endpoint,
      registrationManageSchema.parse(change),
      registrationManageUpdateResponseSchema,
    );
    setEditing(false);
    setMessage(outcomeOf(change, result.emailChanged));
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

  return (
    <Panel aria-label="Registration">
      <PanelHeader title="Registration">
        {!editing && !cancelled && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setMessage("");
                setError("");
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Menu
              label="Registration actions"
              align="end"
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
          </>
        )}
      </PanelHeader>
      <PanelBody>
        <div class="pk-stack">
          <div class="pk-cluster">
            <Badge status={status} />
            <span>{data.registration.isEmailVerified ? "Email confirmed" : "Email confirmation pending"}</span>
          </div>
          {status === "registered" && (
            <RegistrationDayStatusSummary dayAttendance={data.dayAttendance} dayWaitlist={data.dayWaitlist} />
          )}
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
              <ParticipantRegistrationDetails data={data} form={forms.form} daysSummarized={status === "registered"} />
              <RecordCommands
                busy={busy}
                restorable={restorable}
                pendingConfirmation={status === "pending_email_confirmation"}
                offered={offered.length > 0}
                onRestore={() => void run(() => save({ action: "update" }))}
                onResend={() => void run(resendConfirmation)}
                onClaim={() =>
                  void run(() =>
                    save({
                      action: "update",
                      dayAttendance: data.dayAttendance.map(({ dayDate, attendanceType }) => ({
                        dayDate,
                        attendanceType,
                      })),
                      claimDayWaitlistOffers: offered,
                    }),
                  )
                }
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
  offered,
  onRestore,
  onResend,
  onClaim,
}: {
  busy: boolean;
  restorable: boolean;
  pendingConfirmation: boolean;
  offered: boolean;
  onRestore: () => void;
  onResend: () => void;
  onClaim: () => void;
}) {
  if (!restorable && !pendingConfirmation && !offered) return null;
  return (
    <div class="pk-cluster">
      {restorable && (
        <Button variant="primary" loading={busy} onClick={onRestore}>
          Restore registration
        </Button>
      )}
      {offered && (
        <Button variant="primary" loading={busy} onClick={onClaim}>
          Claim offered spots
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
