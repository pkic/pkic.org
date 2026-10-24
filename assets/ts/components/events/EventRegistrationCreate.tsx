import { useMemo, useState } from "preact/hooks";
import type { z } from "zod";
import { eventFormsResponseSchema } from "../../../shared/schemas/forms";
import { myProfileSchema } from "../../../shared/schemas/me";
import { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import { isIdentityOwnedFormKey } from "../../../shared/schemas/form-answers";
import {
  ATTENDANCE_TYPES,
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
  type RegistrationSubmissionResponse,
  type AttendanceType,
} from "../../../shared/schemas/registration";
import { useData } from "../../hooks/useData";
import { useContractForm } from "../../hooks/useContractForm";
import { getJson, postJson } from "../../shared/api-client";
import { attendanceTypeLabel } from "../../shared/attendance";
import { deriveEventAttendanceType } from "../../shared/form/helpers";
import { readConsentValues } from "../../shared/widgets/consents";
import { CustomFieldList, readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Checkbox, Radio } from "../../ui/Checkbox";
import { DescriptionList } from "../../ui/DescriptionList";
import { Field } from "../../ui/Field";
import { SectionHeading } from "../../ui/SectionHeading";
import { TextInput } from "../../ui/TextControl";
import { ConsentList } from "../ConsentCard";
import { DayAttendancePicker } from "../DayAttendancePicker";
import { RegistrationIdentitySelect } from "../RegistrationIdentitySelect";
import { Spinner } from "../Spinner";
import { useFormAnswers } from "../forms/useFormAnswers";

type Config = z.infer<typeof eventFormsResponseSchema>;
type Profile = z.infer<typeof myProfileSchema>;

/** The same event questions and attendance controls, using the existing verified session. */
export function EventRegistrationCreate({
  slug,
  onCancel,
  onRegistered,
}: {
  slug: string;
  onCancel: () => void;
  onRegistered: (result: RegistrationSubmissionResponse) => Promise<void>;
}) {
  const loaded = useData(async () => {
    const [config, profile, session] = await Promise.all([
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/forms/placements/event_registration`,
        eventFormsResponseSchema,
      ),
      getJson("/api/v1/users/current", myProfileSchema),
      getJson("/api/v1/auth/session", userAuthSessionResponseSchema),
    ]);
    return { config, profile, email: session.identity.email };
  }, [slug]);
  if (loaded.loading) return <Spinner label="Loading registration…" />;
  if (!loaded.data) return <Alert tone="danger">{loaded.error}</Alert>;
  return <RegistrationForm {...loaded.data} slug={slug} onCancel={onCancel} onRegistered={onRegistered} />;
}

function RegistrationForm({
  config,
  profile,
  email,
  slug,
  onCancel,
  onRegistered,
}: {
  config: Config;
  profile: Profile;
  email: string;
  slug: string;
  onCancel: () => void;
  onRegistered: (result: RegistrationSubmissionResponse) => Promise<void>;
}) {
  const [names, setNames] = useState({ firstName: profile.firstName ?? "", lastName: profile.lastName ?? "" });
  const [individual, setIndividual] = useState(false);
  const [days, setDays] = useState<Record<string, string>>({});
  const [attendance, setAttendance] = useState<AttendanceType>();
  const [identityId, setIdentityId] = useState<string>();
  const [consents, setConsents] = useState<Array<{ termKey: string; version: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dayAttendance = Object.entries(days)
    .filter(([, type]) => type)
    .map(([dayDate, attendanceType]) => ({ dayDate, attendanceType }));
  const fields = useMemo(
    () => config.form?.fields.filter((field) => !isIdentityOwnedFormKey(field.key)) ?? [],
    [config.form],
  );
  const questions = useFormAnswers(fields, { dayAttendanceTypes: dayAttendance.map((day) => day.attendanceType) });
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const form = useContractForm(registrationCreateSchema, {
    ...names,
    email,
    identityId: individual ? undefined : identityId,
    unaffiliatedAttestation: individual,
    dayAttendance,
    attendanceType: config.eventDays.length ? undefined : attendance,
    consents,
    customAnswers: answers,
    sourceType: "direct",
  });
  function sync(event: Event) {
    const element = questions.formRef.current;
    if (!element) return;
    setConsents(readConsentValues(element));
    setAnswers(readCustomFieldValues(element));
    if (event.type === "input") {
      form.handlers.onInput(event);
      questions.handlers.onInput(event);
    } else {
      form.handlers.onChange(event);
      questions.handlers.onChange(event);
    }
  }
  return (
    <form
      ref={questions.formRef}
      class="pk-stack"
      noValidate
      onInput={(event) => {
        const target = event.target;
        // Choice controls commit through change; updating the form during
        // their preceding input event would restore the old controlled value.
        if (target instanceof HTMLInputElement && (target.type === "radio" || target.type === "checkbox")) return;
        sync(event);
      }}
      onChange={sync}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) sync(event);
      }}
      onFocusOut={(event) => {
        form.handlers.onFocusOut(event);
        questions.handlers.onFocusOut(event);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setError("");
        const answered = questions.submit();
        const checked = form.submit();
        if (!answered.data) return setError(answered.message);
        if (!checked.data) return setError(checked.message);
        setBusy(true);
        try {
          const result = await postJson(
            `/api/v1/events/${encodeURIComponent(slug)}/registrations`,
            checked.data,
            registrationSubmissionResponseSchema,
          );
          await onRegistered(result);
        } catch (cause) {
          questions.refuse(cause);
          setError(form.refuse(cause));
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} class="pk-fieldset pk-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <DescriptionList
          items={[
            ...(profile.firstName && profile.lastName
              ? [{ term: "Name", value: `${profile.firstName} ${profile.lastName}` }]
              : []),
            { term: "Email", value: email },
          ]}
        />
        {(["firstName", "lastName"] as const)
          .filter((key) => !profile[key])
          .map((key) => (
            <Field key={key} label={key === "firstName" ? "First name" : "Last name"} {...form.of(key)}>
              {(control) => (
                <TextInput
                  {...control}
                  name={key}
                  value={names[key]}
                  onInput={(event) => setNames({ ...names, [key]: event.currentTarget.value })}
                />
              )}
            </Field>
          ))}
        <Checkbox
          name="unaffiliatedAttestation"
          label="I'm participating as an individual"
          checked={individual}
          onChange={(event) => {
            setIndividual(event.currentTarget.checked);
            setIdentityId(undefined);
          }}
        />
        {!individual && <RegistrationIdentitySelect onSelect={(id) => setIdentityId(id ?? undefined)} />}
        <Field
          group
          label="Attendance"
          {...(form.ofGroup("dayAttendance").state === "invalid"
            ? form.ofGroup("dayAttendance")
            : form.of("attendanceType"))}
        >
          {() =>
            config.eventDays.length ? (
              <DayAttendancePicker
                days={config.eventDays}
                value={days}
                onChange={(day, type) => setDays({ ...days, [day]: type })}
                allowNotAttending={config.eventDays.length > 1}
              />
            ) : (
              <div class="pk-stack pk-stack--tight">
                {ATTENDANCE_TYPES.map((type) => (
                  <Radio
                    key={type}
                    name="attendanceType"
                    value={type}
                    label={attendanceTypeLabel(type)}
                    checked={attendance === type}
                    onChange={() => setAttendance(type)}
                  />
                ))}
              </div>
            )
          }
        </Field>
        {fields.length > 0 && (
          <section class="pk-stack" aria-label="Event questions">
            <SectionHeading level={3}>{config.form?.title ?? "Event questions"}</SectionHeading>
            <CustomFieldList
              fields={fields}
              context={{ dayAttendance, eventAttendanceType: deriveEventAttendanceType(dayAttendance) ?? attendance }}
              presentationOf={questions.presentationOf}
            />
          </section>
        )}
        <Field group label="Terms and conditions" {...form.ofGroup("consents")}>
          {() => <ConsentList terms={config.requiredTerms} />}
        </Field>
        <div class="pk-cluster">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Register
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
