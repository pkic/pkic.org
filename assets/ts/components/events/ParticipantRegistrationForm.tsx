/**
 * The registration's edit view: the same facts as the read view, as fields.
 *
 * The draft lives here and nowhere else, so discarding is leaving: the next
 * Edit starts again from the registration as it was last loaded. Cancelling
 * the registration is deliberately not offered here — beside "Save changes" it
 * read as "go back without saving". It is a whole-record action and lives in
 * the record's actions menu.
 */
import { useMemo, useState } from "preact/hooks";
import {
  ATTENDANCE_TYPES,
  registrationManageSchema,
  type RegistrationManageReadResponse,
} from "../../../shared/schemas/registration";
import type { z } from "zod";
import { useContractForm } from "../../hooks/useContractForm";
import { useFormAnswers } from "../forms/useFormAnswers";
import { attendanceTypeLabel } from "../../shared/attendance";
import type { EventFormsResponse } from "../../shared/types";
import { CustomFieldList, readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { isIdentityOwnedFormKey } from "../../../shared/schemas/form-answers";
import { RegistrationAffiliation } from "./RegistrationAffiliation";

export type RegistrationChange = z.output<typeof registrationManageSchema>;

const PROFILE_FIELDS = [
  ["email", "Email address"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
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
  });
  // Days change in the registration's own days section; this form sends them as they are.
  const days = data.dayAttendance.map(({ dayDate, attendanceType }) => ({ dayDate, attendanceType }));
  const [attendanceType, setAttendanceType] = useState(data.registration.attendance_type);
  // A legacy answer under an identity-owned key is never sent back.
  const [answers, setAnswers] = useState(
    Object.fromEntries(
      Object.entries(data.registration.custom_answers ?? {}).filter(([key]) => !isIdentityOwnedFormKey(key)),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One array per form definition: the answer contract is rebuilt, and the
  // questions re-read, only when the questions themselves change.
  const customFields = useMemo(
    () => forms.form?.fields.filter((field) => !isIdentityOwnedFormKey(field.key)) ?? [],
    [forms.form],
  );
  const body = {
    action: "update",
    ...draft,
    email: draft.email === data.user.email ? undefined : draft.email,
    dayAttendance: days,
    attendanceType: days.length ? undefined : attendanceType,
    customAnswers: forms.form ? answers : undefined,
  };
  const form = useContractForm(registrationManageSchema, body);
  // The event's questions are judged by the answer contract generated from
  // their definitions, so an unanswered required question — a speaker whose
  // registration the talk's acceptance created has answered none — is marked
  // on the question itself, and so is the server's refusal of one.
  const questions = useFormAnswers(customFields, { dayAttendanceTypes: days.map((day) => day.attendanceType) });
  const readAnswers = (event: Event) => {
    const parent = (event.target as HTMLElement).closest("form");
    if (parent) setAnswers(readCustomFieldValues(parent));
  };
  const handlers = {
    onInput: (event: Event) => {
      form.handlers.onInput(event);
      questions.handlers.onInput(event);
    },
    onChange: (event: Event) => {
      form.handlers.onChange(event);
      questions.handlers.onChange(event);
    },
    onFocusOut: (event: FocusEvent) => {
      form.handlers.onFocusOut(event);
      questions.handlers.onFocusOut(event);
    },
    onClick: questions.handlers.onClick,
  };

  return (
    <form
      noValidate
      ref={questions.formRef}
      {...handlers}
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const answered = forms.form ? questions.submit() : null;
        const checked = form.submit();
        if (answered && !answered.data) {
          setError(answered.message);
          return;
        }
        if (!checked.data) {
          setError(checked.message);
          return;
        }
        setBusy(true);
        try {
          await save(checked.data);
        } catch (cause) {
          questions.refuse(cause);
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
                  onInput={(event) => setDraft({ ...draft, [name]: event.currentTarget.value })}
                />
              )}
            </Field>
          ))}
        </div>
        <RegistrationAffiliation organizationName={data.user.organization_name} jobTitle={data.user.job_title} />
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
        {forms.form && (
          <div class="pk-stack" onInput={readAnswers} onChange={readAnswers}>
            <CustomFieldList
              fields={customFields}
              initialValues={data.registration.custom_answers ?? {}}
              context={{ dayAttendance: days }}
              presentationOf={questions.presentationOf}
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
