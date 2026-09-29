import { useState } from "preact/hooks";
import {
  ATTENDANCE_TYPES,
  registrationResendConfirmationSchema,
  okResponseSchema,
  registrationManageReadResponseSchema,
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
  type RegistrationManageReadResponse,
} from "../../../shared/schemas/registration";
import { eventFormsResponseSchema } from "../../../shared/schemas/forms";
import { useData } from "../../hooks/useData";
import { useContractForm } from "../../hooks/useContractForm";
import { getJson, patchJson, postJson } from "../../shared/api-client";
import { CustomFieldList, readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { RegistrationDayStatusSummary } from "../RegistrationDayStatusSummary";
import { Spinner } from "../Spinner";
import { Badge } from "../Badge";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { Panel, PanelBody, PanelHeader } from "../../ui/Panel";
import type { EventFormsResponse } from "../../shared/types";

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
    <RegistrationEditor
      key={registrationId}
      endpoint={endpoint}
      data={loaded.data.registration}
      forms={loaded.data.forms}
      reload={loaded.reload}
    />
  );
}

function RegistrationEditor({
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const cancelled = data.registration.status === "cancelled";
  const customFields =
    forms.form?.fields.filter((field) => !["organization_name", "job_title"].includes(field.key)) ?? [];
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
  async function save(payload: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await patchJson(
        endpoint,
        registrationManageSchema.parse(payload),
        registrationManageUpdateResponseSchema,
      );
      setMessage(
        result.emailChanged
          ? "Check your new email address to confirm the change. Your registration remains pending until then."
          : "Registration updated.",
      );
      await reload();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  const offered = data.dayWaitlist.filter((day) => day.status === "offered").map((day) => day.dayDate);
  const profileFields = [
    ["email", "Email address"],
    ["firstName", "First name"],
    ["lastName", "Last name"],
    ["organizationName", "Organization"],
    ["jobTitle", "Job title"],
  ] as const;
  return (
    <Panel>
      <PanelHeader title="Registration" />
      <PanelBody>
        <div class="pk-stack">
          <div class="pk-cluster">
            <Badge status={data.registration.status} />
            <span>{data.registration.isEmailVerified ? "Email confirmed" : "Email confirmation pending"}</span>
          </div>
          {data.registration.status === "registered" && (
            <RegistrationDayStatusSummary dayAttendance={data.dayAttendance} dayWaitlist={data.dayWaitlist} />
          )}
          {data.registration.status === "pending_email_confirmation" && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await postJson(
                    `/api/v1/events/${encodeURIComponent(data.event.slug)}/registrations/resend-confirmation`,
                    registrationResendConfirmationSchema.parse({ email: data.user.email }),
                    okResponseSchema,
                  );
                  setMessage("A new confirmation link has been requested. Check your email before continuing.");
                } catch (cause) {
                  setError(form.refuse(cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Resend confirmation email
            </Button>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          {message && <Alert tone="ok">{message}</Alert>}
          {cancelled && (
            <Alert>
              This registration is cancelled.
              {data.registration.cancellation_reason_code === "unauthorized_registration"
                ? " Contact the organizer to review it."
                : " You can restore it if registration is available."}
            </Alert>
          )}
          <form
            noValidate
            {...form.handlers}
            onSubmit={(event) => {
              event.preventDefault();
              const checked = form.submit();
              if (!checked.data) {
                setError(checked.message);
                return;
              }
              void save(checked.data);
            }}
          >
            <fieldset disabled={busy || cancelled} class="pk-fieldset pk-stack">
              <div class="pk-grid">
                {profileFields.map(([name, label]) => (
                  <Field key={name} label={label} {...form.of(name)}>
                    {(control) => (
                      <TextInput
                        {...control}
                        name={name}
                        type={name === "email" ? "email" : "text"}
                        value={draft[name]}
                        readOnly={Boolean(data.identityId && (name === "organizationName" || name === "jobTitle"))}
                        onInput={(event) => setDraft({ ...draft, [name]: event.currentTarget.value })}
                      />
                    )}
                  </Field>
                ))}
              </div>
              {draft.email !== data.user.email && (
                <Alert>
                  A confirmation will be sent to the new address. Signing in does not confirm the address change.
                </Alert>
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
                          {type.replaceAll("_", " ")}
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
                <div
                  class="pk-stack"
                  onInput={(event) => {
                    const element = event.target as HTMLElement;
                    const parent = element.closest("form");
                    if (parent) setAnswers(readCustomFieldValues(parent));
                  }}
                  onChange={(event) => {
                    const element = event.target as HTMLElement;
                    const parent = element.closest("form");
                    if (parent) setAnswers(readCustomFieldValues(parent));
                  }}
                >
                  <CustomFieldList
                    fields={customFields}
                    initialValues={data.registration.custom_answers ?? {}}
                    context={{ dayAttendance: days }}
                  />
                </div>
              )}
              <div class="pk-cluster">
                <Button type="submit" loading={busy}>
                  Save changes
                </Button>
                <Button
                  variant="danger-quiet"
                  onClick={() => {
                    if (confirm("Cancel your registration for this event?")) void save({ action: "cancel" });
                  }}
                >
                  Cancel registration
                </Button>
                {offered.length > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void save({ action: "update", dayAttendance: days, claimDayWaitlistOffers: offered })
                    }
                  >
                    Claim offered spots
                  </Button>
                )}
              </div>
            </fieldset>
          </form>
          {cancelled && data.registration.cancellation_reason_code !== "unauthorized_registration" && (
            <Button loading={busy} onClick={() => void save({ action: "update" })}>
              Restore registration
            </Button>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
