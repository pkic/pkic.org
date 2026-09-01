import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { eventFormsResponseSchema, type EventFormsResponse } from "../../../../../shared/schemas/forms";
import {
  ATTENDANCE_TYPES,
  attendeeRegistrationParticipationSchema,
  registrationSubmissionResponseSchema,
  type AttendanceType,
} from "../../../../../shared/schemas/registration";
import { ConsentList } from "../../../../components/ConsentCard";
import { DayAttendancePicker } from "../../../../components/DayAttendancePicker";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Spinner } from "../../../../ui/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson, postJson } from "../../../../shared/api-client";
import { deriveEventAttendanceType, readField } from "../../../../shared/form/helpers";
import { readConsentValues } from "../../../../shared/widgets/consents";
import { CustomFieldList, readCustomFieldValues } from "../../../../shared/widgets/custom-fields";
import { readDayAttendance } from "../../../../shared/widgets/day-attendance";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
// The attendance radios and the legend are written as class names rather
// than rendered through a component, so this module has to pull in the
// stylesheet that defines them.
import "../../../../ui/Field.css";

const ATTENDANCE_LABELS: Record<AttendanceType, string> = {
  in_person: "In person",
  virtual: "Virtual",
  on_demand: "On demand",
};

function eventRegistrationConfigPath(groupId: string, eventId: string): string {
  return `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registration-config`;
}

function eventRegistrationPath(groupId: string, eventId: string): string {
  return `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations`;
}

function attendanceTypeOptions(): JSX.Element {
  return (
    // A `legend` rather than a `label`: the question names the group of radios,
    // and a label may only point at one control.
    <fieldset class="pk-fieldset pk-field">
      <legend class="pk-field__label">How will you attend?</legend>
      <div class="pk-stack pk-stack--tight">
        {ATTENDANCE_TYPES.map((attendanceType) => (
          <label class="pk-check" key={attendanceType}>
            <input
              class="pk-check__input"
              type="radio"
              name="attendanceType"
              value={attendanceType}
              required={attendanceType === ATTENDANCE_TYPES[0]}
            />
            <span class="pk-check__label">{ATTENDANCE_LABELS[attendanceType]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RegistrationFields({ config }: { config: EventFormsResponse }): JSX.Element {
  const [dayAttendance, setDayAttendance] = useState<Array<{ attendanceType: string }>>([]);
  const [attendanceType, setAttendanceType] = useState<AttendanceType | undefined>();
  const customFieldContext = {
    dayAttendance,
    eventAttendanceType: attendanceType ?? deriveEventAttendanceType(dayAttendance),
  };

  function handleAttendanceChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.checked) return;
    if (target.name === "attendanceType") {
      setAttendanceType(target.value as AttendanceType);
      return;
    }
    if (target.name.startsWith("dayAttendance.")) {
      const next = readDayAttendance(target.form!);
      setDayAttendance(next);
    }
  }

  return (
    <div class="pk-stack" onChange={handleAttendanceChange}>
      {config.eventDays.length > 0 ? (
        <fieldset class="pk-fieldset pk-field">
          <legend class="pk-field__label">Choose your attendance for each day</legend>
          <DayAttendancePicker days={config.eventDays} />
        </fieldset>
      ) : (
        attendanceTypeOptions()
      )}
      {config.form && (
        <div class="pk-stack pk-stack--tight">
          <h4>{config.form.title}</h4>
          {config.form.description && <p class="pk-small">{config.form.description}</p>}
          <CustomFieldList fields={config.form.fields} context={customFieldContext} />
        </div>
      )}
      <div class="pk-stack pk-stack--tight">
        <h4>Terms and conditions</h4>
        <ConsentList terms={config.requiredTerms} />
      </div>
    </div>
  );
}

function RegistrationPanel({ groupId, event }: { groupId: string; event: GroupEvent }): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const config = useData(
    () => getJson(eventRegistrationConfigPath(groupId, event.id), eventFormsResponseSchema),
    [groupId, event.id],
  );

  async function submit(submitEvent: Event): Promise<void> {
    submitEvent.preventDefault();
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setSaving(true);
    setSubmitted(false);
    setSubmitError(null);
    try {
      const dayAttendance = readDayAttendance(form);
      const input = attendeeRegistrationParticipationSchema.parse({
        attendanceType: dayAttendance.length === 0 ? readField(form, "attendanceType") : undefined,
        dayAttendance: dayAttendance.length > 0 ? dayAttendance : undefined,
        customAnswers: readCustomFieldValues(form),
        consents: readConsentValues(form),
      });
      await postJson(eventRegistrationPath(groupId, event.id), input, registrationSubmissionResponseSchema);
      setSubmitted(true);
      setResetKey((key) => key + 1);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Could not complete registration.");
    } finally {
      setSaving(false);
    }
  }

  if (config.loading) return <Spinner label="Loading registration…" />;
  if (config.error) return <ErrorAlert error={config.error} />;
  if (!config.data) return <></>;
  const termsConfigured = config.data.requiredTerms.some((term) => term.required);

  return (
    <Panel class="pk" aria-label={`Register for ${event.name}`}>
      <PanelHeader title="Register for this event" />
      <PanelBody class="pk-stack">
        <p class="pk-small">Your verified portal profile will be used for this registration.</p>
        {!termsConfigured && (
          <Alert tone="warn" title="Registration unavailable">
            Registration is temporarily unavailable because the required event terms have not been configured.
          </Alert>
        )}
        <form class="pk-stack" ref={formRef} onSubmit={(submitEvent) => void submit(submitEvent)}>
          <RegistrationFields key={resetKey} config={config.data} />
          <div class="pk-cluster">
            <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!termsConfigured}>
              {saving ? "Registering…" : "Register"}
            </Button>
          </div>
          {/* The outcome is announced as well as shown: `Alert` carries
              role="status" for the confirmation and role="alert" for the
              failure, so the words reach a reader who never sees the tone. */}
          {submitted && <Alert tone="ok">Registration submitted.</Alert>}
          {submitError && <Alert tone="danger">{submitError}</Alert>}
        </form>
      </PanelBody>
    </Panel>
  );
}

export function GroupEventRegistrationPanel({ groupId, event }: { groupId: string; event: GroupEvent }): JSX.Element {
  if (!event.capabilities.includes("register")) return <></>;
  return <RegistrationPanel groupId={groupId} event={event} />;
}
