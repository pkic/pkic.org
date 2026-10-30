/** One registration form and question pipeline, embedded by public pages and the portal. */
import { render } from "preact";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import type { EventFormsResponse } from "../../../shared/schemas/forms";
import { isIdentityOwnedFormKey } from "../../../shared/schemas/form-answers";
import {
  ATTENDANCE_TYPES,
  registrationCreateSchema,
  registrationCreateForTermsSchema,
  registrationContactFieldsSchema,
  registrationAttendanceFieldsSchema,
  withRequiredDayAttendanceChoices,
  registrationManageSchema,
  registrationSubmissionResponseSchema,
  type RegistrationManageReadResponse,
  type RegistrationSubmissionResponse,
} from "../../../shared/schemas/registration";
import type { FlowBoot } from "../../event-flows/boot";
import { registrationEntry } from "./registration-entry";
import { registrationInvitation } from "./registration-invitation";
import { updateRegistrationReview } from "./registration-review";
import { clearReferralSession } from "../../shared/query-context";
import { forgetRegistrationEmailProof } from "../useRegistrationEmailProof";
import { useContractForm } from "../../hooks/useContractForm";
import { postJson } from "../../shared/api-client";
import { deriveEventAttendanceType, readField } from "../../shared/form/helpers";
import { installStepNavigation, REGISTRATION_STEP_PARAM } from "../../shared/form/step-navigation";
import { CONTRACT_VALIDATION_ATTRIBUTE } from "../../shared/form/validation";
import { splitHash } from "../../ui/url-query";
import { CustomFieldList, readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { readConsentValues } from "../../shared/widgets/consents";
import { readDayAttendance, readDayAttendanceChoices } from "../../shared/widgets/day-attendance";
import { EventFlowProgress } from "../../site/EventFlowProgress";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Radio } from "../../ui/Checkbox";
import { attendanceTypeLabel } from "../../shared/attendance";
import { SectionHeading } from "../../ui/SectionHeading";
import { TextInput } from "../../ui/TextControl";
import { ConsentList } from "../ConsentCard";
import { DayAttendancePicker } from "../DayAttendancePicker";
import { RegistrationContactStep } from "../RegistrationContactStep";
import type { ConfirmOrganizationController } from "../RegistrationConfirmOrganization";
import { RegistrationAffiliation } from "./RegistrationAffiliation";
import { useFormAnswers } from "../forms/useFormAnswers";

export type RegistrationChange = z.output<typeof registrationManageSchema>;
export type RegistrationInput = z.output<typeof registrationCreateSchema>;
type Create = {
  mode: "create";
  context: Omit<FlowBoot, "root" | "form" | "statusEl">;
  autoSession?: boolean;
  submit?: (body: RegistrationInput) => Promise<RegistrationSubmissionResponse>;
  onRegistered: (
    result: RegistrationSubmissionResponse,
    body: RegistrationInput,
    form: HTMLFormElement,
  ) => void | Promise<void>;
};
type Update = {
  mode: "update";
  data: RegistrationManageReadResponse;
  save: (change: RegistrationChange) => Promise<void>;
  onDiscard: () => void;
};
type Props = (Create | Update) & { forms: EventFormsResponse };
const PERSONAL_FIELDS = [
  ["email", "Email address"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
] as const;

export function RegistrationFlow(props: Props) {
  const { forms } = props;
  const updating = props.mode === "update";
  const available = updating || forms.requiredTerms.some((term) => term.required);
  const entry = props.mode === "create" ? registrationEntry(props.context.query) : {};
  const initial = updating ? props.data : null;
  const root = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const review = useRef<HTMLDivElement>(null);
  const organization = useRef<ConfirmOrganizationController>({});
  const invitation = useRef<ReturnType<typeof registrationInvitation> | null>(null);
  const [ready, setReady] = useState(updating);
  const [personalDraft, setPersonalDraft] = useState({
    email: initial?.user.email ?? "",
    firstName: initial?.user.first_name ?? "",
    lastName: initial?.user.last_name ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attendance, setAttendance] = useState(initial?.dayAttendance ?? []);
  const fields = useMemo(
    () => forms.form?.fields.filter((field) => !isIdentityOwnedFormKey(field.key)) ?? [],
    [forms.form],
  );
  const questions = useFormAnswers(fields, { dayAttendanceTypes: attendance.map((day) => day.attendanceType) });
  const element = questions.formRef;
  const currentQuestions = useRef(questions);
  currentQuestions.current = questions;
  const readBody = () => {
    const form = element.current;
    if (!form) return {};
    const dayAttendance = readDayAttendance(form);
    const personal = {
      email: readField(form, "email"),
      firstName: readField(form, "firstName"),
      lastName: readField(form, "lastName"),
    };
    const shared = {
      ...personal,
      dayAttendance: forms.eventDays.length ? dayAttendance : undefined,
      customAnswers: forms.form ? readCustomFieldValues(form) : undefined,
    };
    if (props.mode === "update")
      return {
        ...shared,
        action: "update",
        email: personal.email === props.data.user.email ? undefined : personal.email,
        attendanceType: dayAttendance.length ? undefined : readField(form, "attendanceType") || undefined,
      };
    const named = organization.current.read?.();
    const liveEntry = registrationEntry(props.context.query);
    return {
      ...shared,
      attendanceType: dayAttendance.length ? undefined : readField(form, "attendanceType") || undefined,
      identityId: readField(form, "identityId") || undefined,
      unaffiliatedAttestation: readField(form, "unaffiliatedAttestation") === "true",
      consents: readConsentValues(form),
      emailProof: readField(form, "emailProof") || undefined,
      ...liveEntry,
      sourceType: liveEntry.sourceType ?? "direct",
      sourceRef: liveEntry.sourceType,
      organization: named && !("refused" in named) ? named.organization : undefined,
    };
  };
  const choices = () => (element.current ? readDayAttendanceChoices(element.current) : []);
  const request = useMemo(
    () =>
      withRequiredDayAttendanceChoices(
        updating ? registrationManageSchema : registrationCreateForTermsSchema(forms.requiredTerms),
        choices,
      ),
    [updating, forms.requiredTerms],
  );
  const contract = useContractForm(request, readBody, {
    fieldOf: (name, control) =>
      name === "consents" ? `consents.${control.closest<HTMLElement>("[data-term-key]")?.dataset.termKey ?? ""}` : name,
  });
  const contactContract = useContractForm(registrationContactFieldsSchema, readBody);
  const attendanceContract = useContractForm(
    withRequiredDayAttendanceChoices(registrationAttendanceFieldsSchema, choices),
    readBody,
  );
  const contactReady = useCallback((value: boolean) => setReady(value), []);

  useLayoutEffect(() => {
    if (props.mode !== "create" || !root.current || !element.current || !status.current) return;
    const boot: FlowBoot = { ...props.context, root: root.current, form: element.current, statusEl: status.current };
    invitation.current = registrationInvitation(boot);
    void invitation.current.check(forms.registrationPolicy);
    const navigation = installStepNavigation(
      boot.root,
      boot.form,
      boot.statusEl,
      (step) => {
        if (step === 1) {
          if (boot.form.dataset.contactReady !== "true") return false;
          const checked = contactContract.submit();
          if (!checked.data) {
            setError(checked.formMessage ?? "");
            return false;
          }
          if (organization.current.validate?.() === false) return false;
        }
        if (step === 2) {
          const checked = attendanceContract.submit();
          if (!checked.data) {
            setError(checked.formMessage ?? "");
            return false;
          }
        }
        if (step === 3) {
          const answered = currentQuestions.current.submit();
          if (!answered.data) {
            setError(answered.formMessage ?? "");
            return false;
          }
          updateRegistrationReview(boot.root, boot.form, fields);
        }
      },
      (step) => {
        setError("");
        if (step === 1)
          boot.root.querySelector<HTMLButtonElement>("[data-step-next]")!.hidden =
            boot.form.dataset.contactReady !== "true";
      },
      {
        source: props.autoSession ? "hash" : "search",
        ownerPath: props.autoSession ? splitHash().path : location.pathname,
        param: REGISTRATION_STEP_PARAM,
      },
    );
    return () => {
      navigation.dispose();
      if (review.current) render(null, review.current);
    };
  }, []);

  useLayoutEffect(() => {
    const first = root.current?.querySelector<HTMLElement>('[data-step="1"]');
    const next = root.current?.querySelector<HTMLButtonElement>("[data-step-next]");
    if (first && !first.hidden && next) next.hidden = !ready;
  }, [ready]);

  function syncAttendance(event: Event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name.startsWith("dayAttendance.") && element.current)
      setAttendance(
        readDayAttendanceChoices(element.current)
          .filter((day) => day.answered)
          .map((day) => ({ dayDate: day.dayDate, attendanceType: day.attendanceType, label: null })),
      );
  }

  return (
    <div class="event-flow pk" ref={root} data-registration-flow={props.mode}>
      {!updating && (
        <EventFlowProgress label="Registration progress" steps={["You", "Attendance", "Profile", "Review"]} />
      )}
      <form
        ref={element}
        class="pk-stack needs-validation"
        noValidate
        {...{ [CONTRACT_VALIDATION_ATTRIBUTE]: "" }}
        data-contact-ready={String(ready)}
        onInput={(event) => {
          const target = event.target;
          if (
            target instanceof HTMLSelectElement ||
            (target instanceof HTMLInputElement && (target.type === "radio" || target.type === "checkbox"))
          )
            return;
          contract.handlers.onInput(event);
          contactContract.handlers.onInput(event);
          attendanceContract.handlers.onInput(event);
          questions.handlers.onInput(event);
        }}
        onChange={(event) => {
          syncAttendance(event);
          contract.handlers.onChange(event);
          contactContract.handlers.onChange(event);
          attendanceContract.handlers.onChange(event);
          questions.handlers.onChange(event);
        }}
        onFocusOut={(event) => {
          contract.handlers.onFocusOut(event);
          contactContract.handlers.onFocusOut(event);
          attendanceContract.handlers.onFocusOut(event);
          questions.handlers.onFocusOut(event);
        }}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) questions.handlers.onClick();
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !available || (props.mode === "create" && !invitation.current?.canSubmit())) return;
          setError("");
          if (!updating) {
            const contact = contactContract.submit();
            if (!contact.data) return setError(contact.formMessage ?? "");
            if (organization.current.validate?.() === false) return;
          }
          const answered = currentQuestions.current.submit();
          let checked = contract.submit();
          if (!answered.data) return setError(answered.formMessage ?? "");
          if (!checked.data) return setError(checked.formMessage ?? "");
          setBusy(true);
          try {
            if (!updating && organization.current.prepare) {
              if (!(await organization.current.prepare())) return;
              checked = contract.submit();
              if (!checked.data) return setError(checked.formMessage ?? "");
            }
            if (props.mode === "update") await props.save(registrationManageSchema.parse(checked.data));
            else {
              const body = registrationCreateSchema.parse(checked.data);
              const result = props.submit
                ? await props.submit(body)
                : await postJson(
                    `${props.context.apiBase}/events/${encodeURIComponent(props.context.eventSlug)}/registrations`,
                    body,
                    registrationSubmissionResponseSchema,
                    props.context.eventPagePath ? { "x-event-base-path": props.context.eventPagePath } : undefined,
                  );
              clearReferralSession();
              forgetRegistrationEmailProof();
              await props.onRegistered(result, body, element.current!);
            }
          } catch (cause) {
            if (!invitation.current?.handleError(cause)) {
              questions.refuse(cause);
              setError(contract.refuse(cause));
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset class="pk-fieldset pk-stack" disabled={busy}>
          {error && <Alert tone="danger">{error}</Alert>}
          {!available && (
            <Alert tone="warn" title="Registration unavailable">
              Registration is temporarily unavailable because the required event terms have not been configured.
            </Alert>
          )}
          <section data-step={updating ? undefined : "1"} class="event-flow-step is-active pk-stack">
            {props.mode === "create" ? (
              <div data-registration-contact>
                {available && (
                  <RegistrationContactStep
                    endpoint={`${props.context.apiBase}/events/${encodeURIComponent(props.context.eventSlug)}/registrations`}
                    entry={entry}
                    organization={organization.current}
                    onReadyChange={contactReady}
                    autoSession={props.autoSession}
                    presentationOf={(name) => {
                      const current = contract.of(name);
                      return current.state === "invalid" ? current : contactContract.of(name);
                    }}
                  />
                )}
              </div>
            ) : (
              <>
                {PERSONAL_FIELDS.map(([name, label]) => (
                  <Field key={name} label={label} {...contract.of(name)}>
                    {(control) => (
                      <TextInput
                        {...control}
                        name={name}
                        type={name === "email" ? "email" : "text"}
                        value={personalDraft[name]}
                        onInput={(event) => {
                          const value = event.currentTarget.value;
                          setPersonalDraft((current) => ({ ...current, [name]: value }));
                        }}
                      />
                    )}
                  </Field>
                ))}
                {element.current && readField(element.current, "email") !== props.data.user.email && (
                  <Alert>
                    A confirmation will be sent to the new address. Signing in does not confirm the address change.
                  </Alert>
                )}
                <RegistrationAffiliation
                  organizationName={props.data.user.organization_name}
                  jobTitle={props.data.user.job_title}
                  pendingOrganizationName={props.data.pendingOrganizationName}
                />
              </>
            )}
          </section>
          <section data-step={updating ? undefined : "2"} class="event-flow-step pk-stack" hidden={!updating}>
            <Field
              group
              label="Attendance"
              labelHidden={forms.eventDays.length > 0}
              {...(contract.ofGroup(forms.eventDays.length ? "dayAttendance" : "attendanceType").state === "invalid"
                ? contract.ofGroup(forms.eventDays.length ? "dayAttendance" : "attendanceType")
                : attendanceContract.ofGroup(forms.eventDays.length ? "dayAttendance" : "attendanceType"))}
            >
              {(control) =>
                forms.eventDays.length ? (
                  <DayAttendancePicker
                    control={control}
                    days={forms.eventDays}
                    {...(initial
                      ? {
                          value: Object.fromEntries(attendance.map((day) => [day.dayDate, day.attendanceType])),
                          onChange: (dayDate: string, attendanceType: string) =>
                            setAttendance((current) => [
                              ...current.filter((day) => day.dayDate !== dayDate),
                              { dayDate, attendanceType, label: null },
                            ]),
                        }
                      : {})}
                  />
                ) : (
                  <div class="pk-stack pk-stack--tight">
                    {ATTENDANCE_TYPES.map((type) => (
                      <Radio
                        key={type}
                        name="attendanceType"
                        value={type}
                        label={attendanceTypeLabel(type)}
                        required={type === ATTENDANCE_TYPES[0]}
                        defaultChecked={type === (initial?.registration.attendance_type ?? "virtual")}
                      />
                    ))}
                  </div>
                )
              }
            </Field>
          </section>
          <section data-step={updating ? undefined : "3"} class="event-flow-step pk-stack" hidden={!updating}>
            {!updating && (
              <p class="event-flow-step-intro">Help us tailor the program and connect you with relevant people.</p>
            )}
            <div data-custom-fields>
              {forms.form && fields.length > 0 && (
                <>
                  <SectionHeading level={3}>{forms.form.title}</SectionHeading>
                  {forms.form.description && <p>{forms.form.description}</p>}
                </>
              )}
              <CustomFieldList
                fields={fields}
                initialValues={initial?.registration.custom_answers ?? undefined}
                context={{ dayAttendance: attendance, eventAttendanceType: deriveEventAttendanceType(attendance) }}
                presentationOf={questions.presentationOf}
              />
            </div>
          </section>
          {!updating && (
            <section data-step="4" class="event-flow-step pk-stack" hidden>
              <p class="event-flow-step-intro">Check your details, then accept the terms to register.</p>
              <div data-registration-review ref={review} />
              <Field group label="Terms and conditions" {...contract.ofGroup("consents")}>
                {() => (
                  <div data-consents>
                    <ConsentList terms={forms.requiredTerms} presentationOf={(key) => contract.of(`consents.${key}`)} />
                  </div>
                )}
              </Field>
            </section>
          )}
          <div class={updating ? "pk-cluster" : "event-flow-step-nav"}>
            {updating ? (
              <>
                <Button type="submit" variant="primary" loading={busy}>
                  Save changes
                </Button>
                <Button variant="secondary" onClick={props.onDiscard}>
                  Discard changes
                </Button>
              </>
            ) : (
              <>
                <Button variant="link" data-step-back hidden>
                  Back
                </Button>
                <div class="event-flow-step-forward">
                  <Button variant="primary" data-step-next disabled={!ready || !available}>
                    Continue
                  </Button>
                  <Button type="submit" variant="primary" hidden loading={busy} disabled={!available}>
                    Register
                  </Button>
                </div>
              </>
            )}
          </div>
        </fieldset>
        <p data-flow-status ref={status} class="pk-alert pk-sr-only" role="status" aria-live="polite" />
      </form>
    </div>
  );
}
