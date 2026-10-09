/**
 * The registration's edit view: the same facts as the read view, as fields.
 *
 * The draft lives here and nowhere else, so discarding is leaving: the next
 * Edit starts again from the registration as it was last loaded. Cancelling
 * the registration is deliberately not offered here — beside "Save changes" it
 * read as "go back without saving". It is a whole-record action and lives in
 * the record's actions menu.
 */
import { useState } from "preact/hooks";
import {
  ATTENDANCE_TYPES,
  registrationManageSchema,
  type RegistrationManageReadResponse,
} from "../../../shared/schemas/registration";
import type { z } from "zod";
import { useContractForm } from "../../hooks/useContractForm";
import { attendanceTypeLabel } from "../../shared/attendance";
import type { EventFormsResponse } from "../../shared/types";
import { CustomFieldList, readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { PROFILE_ANSWER_KEYS } from "./ParticipantRegistrationDetails";

export type RegistrationChange = z.output<typeof registrationManageSchema>;

const PROFILE_FIELDS = [
  ["email", "Email address"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["organizationName", "Organization"],
  ["jobTitle", "Job title"],
] as const;

export function ParticipantRegistrationForm({
  data,
  forms,
  save,
  onDiscard,
}: {
  data: RegistrationManageReadResponse;
  forms: EventFormsResponse;
  /** Sends the change; rejects with the server's refusal. */
  save: (change: RegistrationChange) => Promise<void>;
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState({
    email: data.user.email,
    firstName: data.user.first_name ?? "",
    lastName: data.user.last_name ?? "",
    organizationName: data.user.organization_name ?? "",
    jobTitle: data.user.job_title ?? "",
  });
  const [days, setDays] = useState(
    data.dayAttendance.map(({ dayDate, attendanceType }) => ({ dayDate, attendanceType })),
  );
  const [attendanceType, setAttendanceType] = useState(data.registration.attendance_type);
  const [answers, setAnswers] = useState(data.registration.custom_answers ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const customFields = forms.form?.fields.filter((field) => !PROFILE_ANSWER_KEYS.includes(field.key)) ?? [];
  const profileAnswers = Object.fromEntries(
    (forms.form?.fields ?? []).flatMap((field) =>
      field.key === "organization_name"
        ? [[field.key, draft.organizationName]]
        : field.key === "job_title"
          ? [[field.key, draft.jobTitle]]
          : [],
    ),
  );
  const body = {
    action: "update",
    ...draft,
    email: draft.email === data.user.email ? undefined : draft.email,
    dayAttendance: days,
    attendanceType: days.length ? undefined : attendanceType,
    customAnswers: forms.form ? { ...answers, ...profileAnswers } : undefined,
  };
  const form = useContractForm(registrationManageSchema, body);
  const identityLocked = Boolean(data.identityId);
  const readAnswers = (event: Event) => {
    const parent = (event.target as HTMLElement).closest("form");
    if (parent) setAnswers(readCustomFieldValues(parent));
  };

  return (
    <form
      noValidate
      {...form.handlers}
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const checked = form.submit();
        if (!checked.data) {
          setError(checked.message);
          return;
        }
        setBusy(true);
        try {
          await save(checked.data);
        } catch (cause) {
          setError(form.refuse(cause));
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} class="pk-fieldset pk-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <div class="pk-grid">
          {PROFILE_FIELDS.map(([name, label]) => (
            <Field key={name} label={label} {...form.of(name)}>
              {(control) => (
                <TextInput
                  {...control}
                  name={name}
                  type={name === "email" ? "email" : "text"}
                  value={draft[name]}
                  readOnly={identityLocked && (name === "organizationName" || name === "jobTitle")}
                  onInput={(event) => setDraft({ ...draft, [name]: event.currentTarget.value })}
                />
              )}
            </Field>
          ))}
        </div>
        {draft.email !== data.user.email && (
          <Alert>A confirmation will be sent to the new address. Signing in does not confirm the address change.</Alert>
        )}
        {data.eventDays.length === 0 && (
          <Field label="Attendance" {...form.of("attendanceType")}>
            {(control) => (
              <Select
                {...control}
                value={attendanceType}
                onChange={(event) => setAttendanceType(event.currentTarget.value as typeof attendanceType)}
              >
                {ATTENDANCE_TYPES.map((type) => (
                  <option value={type} key={type}>
                    {attendanceTypeLabel(type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {data.eventDays.map((day) => (
          <Field key={day.dayDate} label={day.label ?? day.dayDate} {...form.of("dayAttendance")}>
            {(control) => (
              <Select
                {...control}
                name={`dayAttendance.${day.dayDate}`}
                value={days.find((entry) => entry.dayDate === day.dayDate)?.attendanceType ?? ""}
                onChange={(event) =>
                  setDays([
                    ...days.filter((entry) => entry.dayDate !== day.dayDate),
                    ...(event.currentTarget.value
                      ? [{ dayDate: day.dayDate, attendanceType: event.currentTarget.value }]
                      : []),
                  ])
                }
              >
                <option value="">Not attending</option>
                {day.attendanceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
        {forms.form && (
          <div class="pk-stack" onInput={readAnswers} onChange={readAnswers}>
            <CustomFieldList
              fields={customFields}
              initialValues={data.registration.custom_answers ?? {}}
              context={{ dayAttendance: days }}
            />
          </div>
        )}
        <div class="pk-cluster">
          <Button type="submit" variant="primary" loading={busy}>
            Save changes
          </Button>
          <Button type="button" variant="secondary" onClick={onDiscard}>
            Discard changes
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
