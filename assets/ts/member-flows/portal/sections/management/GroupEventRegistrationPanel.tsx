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
import { useData } from "../../../../hooks/useData";
import { getJson, postJson } from "../../../../shared/api-client";
import { deriveEventAttendanceType, readField } from "../../../../shared/form/helpers";
import { readConsentValues } from "../../../../shared/widgets/consents";
import { CustomFieldList, readCustomFieldValues } from "../../../../shared/widgets/custom-fields";
import { readDayAttendance } from "../../../../shared/widgets/day-attendance";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";

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
    <fieldset>
      <legend class="form-label small fw-semibold">How will you attend?</legend>
      <div class="d-flex flex-column gap-2">
        {ATTENDANCE_TYPES.map((attendanceType) => (
          <label class="form-check" key={attendanceType}>
            <input
              class="form-check-input"
              type="radio"
              name="attendanceType"
              value={attendanceType}
              required={attendanceType === ATTENDANCE_TYPES[0]}
            />
            <span class="form-check-label">{ATTENDANCE_LABELS[attendanceType]}</span>
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
    <div onChange={handleAttendanceChange}>
      {config.eventDays.length > 0 ? (
        <div>
          <p class="form-label small fw-semibold">Choose your attendance for each day</p>
          <DayAttendancePicker days={config.eventDays} />
        </div>
      ) : (
        attendanceTypeOptions()
      )}
      {config.form && (
        <div>
          <h6 class="small fw-semibold">{config.form.title}</h6>
          {config.form.description && <p class="small text-muted">{config.form.description}</p>}
          <CustomFieldList fields={config.form.fields} context={customFieldContext} />
        </div>
      )}
      <div>
        <h6 class="small fw-semibold">Terms and conditions</h6>
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

  if (config.loading) return <p class="small text-muted">Loading registration…</p>;
  if (config.error) return <ErrorAlert error={config.error} />;
  if (!config.data) return <></>;
  const termsConfigured = config.data.requiredTerms.some((term) => term.required);

  return (
    <section class="border-top pt-3" aria-label={`Register for ${event.name}`}>
      <h6>Register for this event</h6>
      <p class="small text-muted">Your verified portal profile will be used for this registration.</p>
      {!termsConfigured && (
        <div class="alert alert-warning" role="alert">
          Registration is temporarily unavailable because the required event terms have not been configured.
        </div>
      )}
      <form ref={formRef} onSubmit={(submitEvent) => void submit(submitEvent)}>
        <RegistrationFields key={resetKey} config={config.data} />
        <div class="d-flex gap-2 align-items-center mt-3">
          <button type="submit" class="btn btn-sm btn-primary" disabled={saving || !termsConfigured}>
            {saving ? "Registering…" : "Register"}
          </button>
          {submitted && <span class="small text-success">Registration submitted.</span>}
          {submitError && <span class="small text-danger">{submitError}</span>}
        </div>
      </form>
    </section>
  );
}

export function GroupEventRegistrationPanel({ groupId, event }: { groupId: string; event: GroupEvent }): JSX.Element {
  if (!event.capabilities.includes("register")) return <></>;
  return <RegistrationPanel groupId={groupId} event={event} />;
}
