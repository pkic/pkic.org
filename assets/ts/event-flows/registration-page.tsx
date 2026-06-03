import { render, createRef } from "preact";
import type { ComponentChildren } from "preact";
import { getJson, postJson } from "../shared/api-client";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../shared/widgets/consents";
import {
  renderCustomFields,
  readCustomFieldValues,
  type CustomFieldsController,
} from "../shared/widgets/custom-fields";
import { readDayAttendance, renderDayAttendance } from "../shared/widgets/day-attendance";
import { renderSharePanel } from "../shared/widgets/share-panel";
import { renderDonationCta } from "../shared/donation/cta";
import type { EventFormsResponse, FormField } from "../shared/types";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { installStepNavigation } from "../shared/form/step-navigation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { clearReferralSession } from "../shared/query-context";
import { registrationCreateSchema } from "../../shared/schemas/api";
import { readField, deriveEventAttendanceType, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { optionsFor } from "../shared/form/custom-field-rules";

interface RegistrationSubmitResponse {
  success: boolean;
  status: string;
  manageUrl?: string;
  shareUrl?: string;
  manageToken?: string;
}

const EMAIL_REVIEW_FIELD = "emailReviewConfirmed";

type CustomAnswerValue = string | number | boolean | string[] | { start: string; end: string };

function formatSubmittedEmail(email: string): ComponentChildren {
  return <span class="event-flow-address">{email || "the email address you entered"}</span>;
}

function showSuccessPanel(
  root: HTMLElement,
  form: HTMLFormElement,
  result: RegistrationSubmitResponse,
  firstName: string,
  lastName: string,
  email: string,
  organization: string,
  eventName: string,
  eventSlug: string,
  days?: number,
): void {
  form.classList.add("d-none");
  const stepper = root.querySelector<HTMLElement>(".event-flow-stepper");
  if (stepper) {
    stepper.hidden = true;
    stepper.setAttribute("aria-hidden", "true");
  }

  let icon: string;
  let title: string;
  let body: ComponentChildren;
  let showShare = false;

  if (result.status === "pending_email_confirmation") {
    icon = "✉️";
    title = `Check your email to finish registration${firstName ? `, ${firstName}` : ""}`;
    body = (
      <>
        <div class="event-flow-pending-alert text-start" role="alert">
          <span class="event-flow-review-warning-marker" aria-hidden="true">
            !
          </span>
          <div>
            <p class="event-flow-pending-alert-title">
              IMPORTANT: Click the link in the email to confirm your registration
            </p>
            <ul class="event-flow-pending-steps">
              <li>We sent the confirmation link to {formatSubmittedEmail(email)}.</li>
              <li>Keep this page open until the email arrives.</li>
              <li>Open the email, click the confirmation link, and confirm on the next page.</li>
              <li>
                Your spot is not secured and you will not be admitted until you receive the final confirmation email.
              </li>
              <li>That final email may still say you are on the waitlist for one or more days.</li>
            </ul>
          </div>
        </div>
        <div class="event-flow-submission-review text-start">
          <p class="event-flow-submission-review-label">Confirmation email sent to</p>
          <p class="event-flow-submission-review-value">{email}</p>
          {result.manageUrl && (
            <div class="event-flow-submission-action">
              <p class="small mb-0">Wrong email address?</p>
              <a href={result.manageUrl} class="btn btn-outline-success">
                Edit email address
              </a>
            </div>
          )}
        </div>
        <p class="text-muted small mb-0">
          If the email does not arrive after a few minutes, check your spam folder and confirm that the address above is
          correct.
        </p>
      </>
    );
  } else if (result.status === "waitlisted") {
    icon = "📋";
    title = "You're on the waitlist!";
    showShare = !!result.shareUrl;
    body = (
      <p class="event-flow-success-body">
        In-person spots are fully booked. We've added you to the waitlist and will notify you by email if a spot becomes
        available.
        {result.manageUrl && (
          <a href={result.manageUrl} class="d-block mt-2">
            Manage your waitlist entry
          </a>
        )}
      </p>
    );
  } else {
    icon = "🎉";
    title = `You're registered${firstName ? `, ${firstName}` : ""}!`;
    showShare = !!result.shareUrl;
    body = (
      <p class="event-flow-success-body">
        A confirmation email with your calendar invite is on its way.{" "}
        {result.manageUrl && <a href={result.manageUrl}>Manage your registration</a>}
      </p>
    );
  }

  const container = document.createElement("div");
  const shareRef = createRef<HTMLDivElement>();
  const donateRef = createRef<HTMLDivElement>();

  render(
    <SuccessPanel icon={icon} title={title}>
      {body}
      {showShare && <div ref={shareRef} />}
      <div ref={donateRef} />
    </SuccessPanel>,
    container,
  );

  if (showShare && shareRef.current && result.shareUrl) {
    renderSharePanel(shareRef.current, {
      shareUrl: result.shareUrl,
      eventName,
      firstName,
      manageToken: result.manageToken,
      eventSlug,
    });
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (donateRef.current) {
    renderDonationCta(donateRef.current, {
      name: fullName || undefined,
      email,
      organizationName: organization || undefined,
      source: window.location.pathname,
      days,
    });
  }

  root.appendChild(container);
  requestAnimationFrame(() => {
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function readAttendanceReview(form: HTMLFormElement): Array<{ label: string; value: string }> {
  const selected = Array.from(form.querySelectorAll<HTMLInputElement>("input[name^='dayAttendance.']:checked"));
  if (selected.length === 0) {
    return [{ label: "Event attendance", value: "Virtual / online attendance" }];
  }

  return selected
    .map((field) => {
      const day = field.closest<HTMLElement>(".event-flow-day");
      const dayLabel = day?.querySelector<HTMLElement>(".event-flow-day-label")?.textContent?.trim();
      const optionLabel = field.nextElementSibling
        ?.querySelector<HTMLElement>(".event-flow-attendance-title")
        ?.textContent?.trim();
      return { label: dayLabel || field.name.replace(/^dayAttendance\./, ""), value: optionLabel || field.value };
    })
    .filter((entry) => entry.label || entry.value);
}

function resolveCustomFieldValue(
  form: HTMLFormElement,
  field: FormField,
  answers: Record<string, CustomAnswerValue>,
): { value: string; empty: boolean } {
  const raw = answers[field.key];
  const options = optionsFor(field);
  const optionLabel = (value: string): string => options.find((option) => option.value === value)?.label ?? value;

  if (Array.isArray(raw)) {
    return raw.length > 0
      ? { value: raw.map(optionLabel).join(", "), empty: false }
      : { value: "None provided", empty: true };
  }

  if (typeof raw === "object" && raw !== null) {
    const start = raw.start?.trim();
    const end = raw.end?.trim();
    return start && end ? { value: `${start} to ${end}`, empty: false } : { value: "None provided", empty: true };
  }

  if (typeof raw === "boolean") {
    return { value: raw ? "Yes" : "No", empty: false };
  }

  if (typeof raw === "number") {
    return { value: String(raw), empty: false };
  }

  if (typeof raw === "string" && raw.trim()) {
    const select = form.querySelector<HTMLSelectElement>(`select[name='custom.${field.key}']`);
    const selectedLabel = select?.selectedOptions[0]?.textContent?.trim();
    return { value: selectedLabel || optionLabel(raw.trim()), empty: false };
  }

  return { value: "None provided", empty: true };
}

function visibleCustomFields(root: HTMLElement, fields: FormField[]): FormField[] {
  const visibleKeys = new Set(
    Array.from(root.querySelectorAll<HTMLElement>("[data-custom-field-key]"))
      .filter((row) => row.getAttribute("aria-hidden") !== "true")
      .map((row) => row.dataset.customFieldKey)
      .filter((key): key is string => Boolean(key)),
  );

  return fields.filter((field) => visibleKeys.has(field.key)).sort((a, b) => a.sortOrder - b.sortOrder);
}

function ReviewEditButton({ step, label }: { step: number; label: string }) {
  return (
    <button type="button" class="event-flow-review-edit" data-step-jump={step} aria-label={`Edit ${label}`}>
      Edit
    </button>
  );
}

function ReviewSection({ title, step, children }: { title: string; step: number; children: ComponentChildren }) {
  return (
    <section class="event-flow-review-section" aria-labelledby={`registration-review-${step}`}>
      <div class="event-flow-review-section-heading">
        <div>
          <p class="event-flow-review-section-title" id={`registration-review-${step}`}>
            {title}
          </p>
        </div>
        <ReviewEditButton step={step} label={title.toLowerCase()} />
      </div>
      <dl class="event-flow-review-list">{children}</dl>
    </section>
  );
}

function ReviewRow({
  label,
  value,
  empty = false,
  valueClass,
}: {
  label: string;
  value: string;
  empty?: boolean;
  valueClass?: string;
}) {
  const className = [empty ? "text-muted" : "", valueClass ?? ""].filter(Boolean).join(" ") || undefined;

  return (
    <div class="event-flow-review-row">
      <dt>{label}</dt>
      <dd class={className}>{value}</dd>
    </div>
  );
}

function RegistrationReview({
  fullName,
  email,
  attendance,
  customFields,
  customAnswers,
  form,
}: {
  fullName: string;
  email: string;
  attendance: Array<{ label: string; value: string }>;
  customFields: FormField[];
  customAnswers: Record<string, CustomAnswerValue>;
  form: HTMLFormElement;
}) {
  return (
    <section class="event-flow-review" aria-label="Registration review">
      <div class="event-flow-review-header">
        <div>
          <p class="event-flow-review-eyebrow">Check this first</p>
          <h3 class="event-flow-review-title">Confirmation email</h3>
          <p class="event-flow-review-email" data-registration-review-email>
            {email || "Not provided yet"}
          </p>
        </div>
        <div class="event-flow-review-critical">
          <span class="event-flow-review-status">Registration pending email confirmation</span>
          <div class="event-flow-review-warning" role="note">
            <span class="event-flow-review-warning-marker" aria-hidden="true">
              !
            </span>
            <p class="event-flow-review-help">
              <strong>Check your email address.</strong> We will send the confirmation link to this address. Your spot
              is not secured and your registration is not final until you confirm through that email.
            </p>
          </div>
        </div>
      </div>

      <ReviewSection title="Contact" step={1}>
        <ReviewRow label="Name" value={fullName || "Not provided yet"} empty={!fullName} />
        <ReviewRow
          label="Email"
          value={email || "Not provided yet"}
          empty={!email}
          valueClass="event-flow-review-email-inline"
        />
      </ReviewSection>

      <ReviewSection title="Attendance" step={2}>
        {attendance.map((entry) => (
          <ReviewRow key={`${entry.label}-${entry.value}`} label={entry.label} value={entry.value} />
        ))}
      </ReviewSection>

      {customFields.length > 0 && (
        <ReviewSection title="Profile details" step={3}>
          {customFields.map((field) => {
            const resolved = resolveCustomFieldValue(form, field, customAnswers);
            return <ReviewRow key={field.key} label={field.label} value={resolved.value} empty={resolved.empty} />;
          })}
        </ReviewSection>
      )}
    </section>
  );
}

function updateRegistrationReview(root: HTMLElement, form: HTMLFormElement, customFieldDefs: FormField[]): void {
  const firstName = readField(form, "firstName");
  const lastName = readField(form, "lastName");
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const email = readField(form, "email");

  const reviewEl = root.querySelector<HTMLElement>("[data-registration-review]");
  const inlineEmailEl = root.querySelector<HTMLElement>("[data-registration-review-email-inline]");

  if (reviewEl) {
    if (reviewEl.dataset.registrationReviewMounted !== "true") {
      reviewEl.textContent = "";
      reviewEl.dataset.registrationReviewMounted = "true";
    }
    render(
      <RegistrationReview
        fullName={fullName}
        email={email}
        attendance={readAttendanceReview(form)}
        customFields={visibleCustomFields(root, customFieldDefs)}
        customAnswers={readCustomFieldValues(form) as Record<string, CustomAnswerValue>}
        form={form}
      />,
      reviewEl,
    );
  }

  if (inlineEmailEl) inlineEmailEl.textContent = email || "the email address above";
}

function resetEmailReviewConfirmation(form: HTMLFormElement): void {
  const confirmation = form.elements.namedItem(EMAIL_REVIEW_FIELD);
  if (confirmation instanceof HTMLInputElement) {
    confirmation.checked = false;
    syncEmailReviewCard(form);
  }
}

function syncEmailReviewCard(form: HTMLFormElement): void {
  const confirmation = form.elements.namedItem(EMAIL_REVIEW_FIELD);
  if (!(confirmation instanceof HTMLInputElement)) return;

  const card = confirmation.closest<HTMLElement>("[data-email-review-card]");
  if (!card) return;

  card.classList.toggle("is-checked", confirmation.checked);
  card.classList.toggle("is-invalid", form.classList.contains("was-validated") && !confirmation.checked);
  card.setAttribute("aria-checked", String(confirmation.checked));
}

function installEmailReviewCard(form: HTMLFormElement): void {
  const confirmation = form.elements.namedItem(EMAIL_REVIEW_FIELD);
  if (!(confirmation instanceof HTMLInputElement)) return;

  const card = confirmation.closest<HTMLElement>("[data-email-review-card]");
  if (!card) return;

  const toggle = (): void => {
    confirmation.checked = !confirmation.checked;
    confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    syncEmailReviewCard(form);
  };

  card.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("label, input")) return;
    toggle();
  });
  card.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    toggle();
  });
  confirmation.addEventListener("change", () => syncEmailReviewCard(form));
  syncEmailReviewCard(form);
}

async function applyGeoHint(controller: CustomFieldsController, apiBase: string): Promise<void> {
  try {
    const geo = await getJson<{ country: string | null }>(`${apiBase}/geo`);
    if (geo.country) controller.setGeoHint(geo.country);
  } catch {
    // Geo lookup is best-effort — never block or break the form.
  }
}

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-registration]");
  if (!boot) {
    return;
  }

  const { form, statusEl, eventSlug, eventPagePath, apiBase, query } = boot;
  const eventPathHeaders = eventPagePath ? { "x-event-base-path": eventPagePath } : undefined;
  let customFieldDefs: FormField[] = [];
  installLiveValidation(form, statusEl);
  installEmailReviewCard(form);
  installStepNavigation(boot.root, form, statusEl, (currentStep) => {
    if (currentStep === 3) {
      updateRegistrationReview(boot.root, form, customFieldDefs);
    }
  });
  const consentsContainer = boot.root.querySelector<HTMLElement>("[data-consents]");
  const customFieldsContainer = boot.root.querySelector<HTMLElement>("[data-custom-fields]");
  const dayAttendanceContainer = boot.root.querySelector<HTMLElement>("[data-day-attendance]");

  let eventName = eventSlug;
  let eventDayCount = 0;
  let customFields: CustomFieldsController | null = null;

  try {
    const forms = await getJson<EventFormsResponse>(`${apiBase}/events/${eventSlug}/forms?purpose=event_registration`);
    eventName = forms.event.name;
    eventDayCount = forms.eventDays.length;
    if (consentsContainer) {
      renderConsentInputs(consentsContainer, forms.requiredTerms);
    }
    if (customFieldsContainer && forms.form) {
      customFieldDefs = forms.form.fields;
      customFields = renderCustomFields(customFieldsContainer, forms.form.fields);
    }
    if (dayAttendanceContainer) {
      renderDayAttendance(dayAttendanceContainer, forms.eventDays);
    }
    if (customFields) {
      const dayAttendance = readDayAttendance(form);
      customFields.updateVisibility({
        dayAttendance,
        eventAttendanceType: deriveEventAttendanceType(dayAttendance),
      });
    }

    // Apply Cloudflare geo hint to any country-select widgets.
    // Fire-and-forget: we don't block form load on this.
    if (customFields) void applyGeoHint(customFields, apiBase);
  } catch {
    setStatus(statusEl, "Could not load registration form details.", true);
  }

  form.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }
    if (!target.name.startsWith("dayAttendance.")) {
      return;
    }
    if (!customFields) {
      return;
    }
    const dayAttendance = readDayAttendance(form);
    customFields.updateVisibility({
      dayAttendance,
      eventAttendanceType: deriveEventAttendanceType(dayAttendance),
    });
  });

  form.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "email") {
      resetEmailReviewConfirmation(form);
    }
    updateRegistrationReview(boot.root, form, customFieldDefs);
  });

  form.addEventListener("change", () => {
    updateRegistrationReview(boot.root, form, customFieldDefs);
  });

  const referralInput = form.elements.namedItem("referralCode");
  if (query.referralCode && referralInput instanceof HTMLInputElement) {
    referralInput.value = query.referralCode;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    updateRegistrationReview(boot.root, form, customFieldDefs);
    form.classList.add("was-validated");
    syncConsentValidation(form);
    if (!validateBeforeSubmit(form, statusEl)) {
      return;
    }

    await withLoadingButton(findSubmitButton(form), async () => {
      try {
        const firstName = readField(form, "firstName");
        const dayAttendance = readDayAttendance(form);
        const payload = registrationCreateSchema.parse({
          firstName,
          lastName: readField(form, "lastName"),
          email: readField(form, "email"),
          attendanceType: dayAttendance.length === 0 ? "virtual" : undefined,
          dayAttendance,
          sourceType: query.sourceType ?? "direct",
          sourceRef: query.sourceType ?? undefined,
          customAnswers: readCustomFieldValues(form),
          inviteToken: query.inviteToken ?? undefined,
          inviteId: query.inviteId ?? undefined,
          referralCode: query.referralCode ?? undefined,
          consents: readConsentValues(form),
        });

        const result = await postJson<RegistrationSubmitResponse>(
          `${apiBase}/events/${eventSlug}/registrations`,
          payload,
          eventPathHeaders,
        );
        clearReferralSession();
        showSuccessPanel(
          boot.root,
          form,
          result,
          firstName,
          payload.lastName,
          payload.email,
          "",
          eventName,
          boot.eventSlug,
          eventDayCount || undefined,
        );
      } catch (error) {
        handleSubmitError(error, form, statusEl);
      }
    });
  });
}

void main();
