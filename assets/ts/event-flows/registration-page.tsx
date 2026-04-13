import { render, createRef } from "preact";
import type { ComponentChildren } from "preact";
import { getJson, postJson } from "../shared/api-client";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../shared/widgets/consents";
import { renderCustomFields, readCustomFieldValues, type CustomFieldsController } from "../shared/widgets/custom-fields";
import { readDayAttendance, renderDayAttendance } from "../shared/widgets/day-attendance";
import { renderSharePanel } from "../shared/widgets/share-panel";
import { renderDonationCta } from "../shared/donation/cta";
import type { EventFormsResponse } from "../shared/types";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { installStepNavigation } from "../shared/form/step-navigation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { clearReferralSession } from "../shared/query-context";
import { registrationCreateSchema } from "../../shared/schemas/api";
import { readField, deriveEventAttendanceType, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";

interface RegistrationSubmitResponse {
  success: boolean;
  status: string;
  manageUrl?: string;
  shareUrl?: string;
  manageToken?: string;
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

  let icon: string;
  let title: string;
  let body: ComponentChildren;
  let showShare = false;

  if (result.status === "pending_email_confirmation") {
    icon = "✉️";
    title = `Almost there${firstName ? `, ${firstName}` : ""}!`;
    body = (
      <>
        <p class="event-flow-success-body">
          We've sent a confirmation link to your email address. Click it to
          complete your registration — it takes just one click.
        </p>
        <p class="text-muted small mb-0">
          Can't find it? Check your spam folder, or contact us if it doesn't
          arrive within a few minutes.
        </p>
      </>
    );
  } else if (result.status === "waitlisted") {
    icon = "📋";
    title = "You're on the waitlist!";
    showShare = !!result.shareUrl;
    body = (
      <p class="event-flow-success-body">
        In-person spots are fully booked. We've added you to the waitlist
        and will notify you by email if a spot becomes available.
        {result.manageUrl && (
          <a href={result.manageUrl} class="d-block mt-2">Manage your waitlist entry</a>
        )}
      </p>
    );
  } else {
    icon = "🎉";
    title = `You're registered${firstName ? `, ${firstName}` : ""}!`;
    showShare = !!result.shareUrl;
    body = (
      <p class="event-flow-success-body">
        A confirmation email with your calendar invite is on its way.
        {" "}
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
}

// installStepNavigation is now in shared/step-navigation.ts

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
  installLiveValidation(form, statusEl);
  installStepNavigation(boot.root, form, statusEl);
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

  const referralInput = form.elements.namedItem("referralCode");
  if (query.referralCode && referralInput instanceof HTMLInputElement) {
    referralInput.value = query.referralCode;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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
          referralCode: query.referralCode ?? undefined,
          consents: readConsentValues(form),
        });

        const result = await postJson<RegistrationSubmitResponse>(`${apiBase}/events/${eventSlug}/registrations`, payload, eventPathHeaders);
        clearReferralSession();
        showSuccessPanel(boot.root, form, result, firstName, payload.lastName, payload.email, "", eventName, boot.eventSlug, eventDayCount || undefined);
      } catch (error) {
        handleSubmitError(error, form, statusEl);
      }
    });
  });
}

void main();

