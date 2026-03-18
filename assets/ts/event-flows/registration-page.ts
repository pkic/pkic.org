import { getJson, postJson } from "../shared/api-client";
import { applyFieldErrors, normalizeValidation } from "../shared/validation-map";
import { renderConsentInputs, readConsentValues } from "../shared/render-consents";
import { applyCustomFieldVisibility, renderCustomFields, readCustomFieldValues } from "../shared/render-custom-fields";
import { readDayAttendance, renderDayAttendance } from "../shared/render-day-attendance";
import { renderSharePanel } from "../shared/render-share-panel";
import { renderDonationCta } from "../shared/render-donation-cta";
import type { EventFormsResponse } from "../shared/types";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form-validation";
import { installStepNavigation } from "../shared/step-navigation";
import { bootstrap, setStatus } from "./boot";
import { clearReferralSession } from "../shared/query-context";

interface RegistrationSubmitResponse {
  success: boolean;
  status: string;
  manageUrl?: string;
  shareUrl?: string;
  manageToken?: string;
}

function readRequired(form: HTMLFormElement, key: string): string {
  const input = form.elements.namedItem(key);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement)) {
    return "";
  }
  return input.value.trim();
}

function deriveEventAttendanceType(
  values: Array<{ attendanceType: string }>,
): "in_person" | "virtual" | "on_demand" | undefined {
  if (values.some((entry) => entry.attendanceType === "in_person")) {
    return "in_person";
  }
  if (values.some((entry) => entry.attendanceType === "virtual")) {
    return "virtual";
  }
  if (values.length > 0) {
    return "on_demand";
  }
  return undefined;
}

/**
 * Shows the post-submission success panel.
 *
 * Psychology applied:
 * - Peak-End Rule: the sharing prompt at the end is the most remembered moment.
 * - Zeigarnik Effect: pending-email state creates productive tension ("almost
 *   done — check your inbox") that drives completion.
 * - Mimetic Desire: "colleagues have already registered" social proof framing.
 * - Reciprocity: we lead with thanks and a personal acknowledgement before
 *   asking the registrant to spread the word.
 */
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
): void {
  form.classList.add("d-none");

  const panel = document.createElement("div");
  panel.className = "event-flow-success";

  if (result.status === "pending_email_confirmation") {
    // Zeigarnik Effect: leave a deliberate open loop — "almost there".
    panel.innerHTML = `
      <div class="event-flow-success-icon" aria-hidden="true">✉️</div>
      <h2 class="event-flow-success-title">Almost there${firstName ? `, ${firstName}` : ""}!</h2>
      <p class="event-flow-success-body">
        We've sent a confirmation link to your email address. Click it to
        complete your registration — it takes just one click.
      </p>
      <p class="text-muted small mb-0">
        Can't find it? Check your spam folder, or contact us if it doesn't
        arrive within a few minutes.
      </p>
    `;
  } else if (result.status === "waitlisted") {
    panel.innerHTML = `
      <div class="event-flow-success-icon" aria-hidden="true">📋</div>
      <h2 class="event-flow-success-title">You're on the waitlist!</h2>
      <p class="event-flow-success-body">
        In-person spots are fully booked. We've added you to the waitlist
        and will notify you by email if a spot becomes available.
        ${result.manageUrl ? `<a href="${result.manageUrl}" class="d-block mt-2">Manage your waitlist entry</a>` : ""}
      </p>
    `;
    // Waitlisted: sharing is especially valuable — more shares = community
    // growth = justification for a larger venue next year.
    if (result.shareUrl) {
      const shareContainer = document.createElement("div");
      renderSharePanel(shareContainer, {
        shareUrl: result.shareUrl,
        eventName,
        firstName,
        manageToken: result.manageToken,
        eventSlug,
      });
      panel.appendChild(shareContainer);
    }
  } else {
    // status === "registered" — Peak-End moment: share link is the payoff.
    panel.innerHTML = `
      <div class="event-flow-success-icon" aria-hidden="true">🎉</div>
      <h2 class="event-flow-success-title">You're registered${firstName ? `, ${firstName}` : ""}!</h2>
      <p class="event-flow-success-body">
        A confirmation email with your calendar invite is on its way.
        ${result.manageUrl ? `<a href="${result.manageUrl}">Manage your registration</a>` : ""}
      </p>
    `;
    if (result.shareUrl) {
      const shareContainer = document.createElement("div");
      renderSharePanel(shareContainer, {
        shareUrl: result.shareUrl,
        eventName,
        firstName,
        manageToken: result.manageToken,
        eventSlug,
      });
      panel.appendChild(shareContainer);
    }
  }

  // Donation CTA — shown on all outcomes; emotional investment is high
  // regardless of whether the registration is confirmed, pending, or waitlisted.
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  renderDonationCta(panel, { name: fullName || undefined, email, organizationName: organization || undefined, source: window.location.pathname });

  root.appendChild(panel);
}

// installStepNavigation is now in shared/step-navigation.ts

/**
 * Fetches the Cloudflare geo hint (IP-based country) from /api/v1/geo and
 * applies it to any country-select widgets rendered on the page.
 *
 * Fails silently — the form works perfectly without it. The hint is a soft
 * suggestion: it only pre-selects if the user hasn't already chosen a country.
 */
async function applyGeoHintToCountryWidgets(root: HTMLElement, apiBase: string): Promise<void> {
  try {
    const geo = await getJson<{ country: string | null }>(`${apiBase}/geo`);
    if (!geo.country) return;

    const countryWrappers = root.querySelectorAll<HTMLElement>("[data-country-widget]");
    for (const wrapper of Array.from(countryWrappers)) {
      const fn = (wrapper as HTMLElement & { applyGeoHint?: (code: string | null) => void }).applyGeoHint;
      if (typeof fn === "function") {
        fn(geo.country);
      }
    }
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

  try {
    const forms = await getJson<EventFormsResponse>(`${apiBase}/events/${eventSlug}/forms?purpose=event_registration`);
    eventName = forms.event.name;
    if (consentsContainer) {
      renderConsentInputs(consentsContainer, forms.requiredTerms);
    }
    if (customFieldsContainer && forms.form) {
      renderCustomFields(customFieldsContainer, forms.form.fields);
    }
    if (dayAttendanceContainer) {
      renderDayAttendance(dayAttendanceContainer, forms.eventDays);
    }
    if (customFieldsContainer) {
      const dayAttendance = readDayAttendance(form);
      applyCustomFieldVisibility(customFieldsContainer, {
        dayAttendance,
        eventAttendanceType: deriveEventAttendanceType(dayAttendance),
      });
    }

    // Apply Cloudflare geo hint to any country-select widgets.
    // Fire-and-forget: we don't block form load on this.
    void applyGeoHintToCountryWidgets(boot.root, apiBase);

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
    if (!customFieldsContainer) {
      return;
    }
    const dayAttendance = readDayAttendance(form);
    applyCustomFieldVisibility(customFieldsContainer, {
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
    if (!validateBeforeSubmit(form, statusEl)) {
      return;
    }

    const submit = form.querySelector<HTMLButtonElement>("button[type='submit']");
    if (submit) {
      submit.disabled = true;
    }

    try {
      const firstName = readRequired(form, "firstName");
      const dayAttendance = readDayAttendance(form);
      const payload = {
        firstName,
        lastName: readRequired(form, "lastName"),
        email: readRequired(form, "email"),
        attendanceType: dayAttendance.length === 0 ? "virtual" : undefined,
        dayAttendance,
        sourceType: query.sourceType ?? "direct",
        sourceRef: query.sourceType ?? undefined,
        customAnswers: readCustomFieldValues(form),
        inviteToken: query.inviteToken ?? undefined,
        referralCode: query.referralCode ?? undefined,
        consents: readConsentValues(form),
      };

      const result = await postJson<RegistrationSubmitResponse>(`${apiBase}/events/${eventSlug}/registrations`, payload, eventPathHeaders);
      clearReferralSession();
      showSuccessPanel(boot.root, form, result, firstName, payload.lastName, payload.email, "", eventName, boot.eventSlug);
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(statusEl, normalized.globalMessage, true);
      applyFieldErrors(form, normalized.fields);
    } finally {
      const submit = form.querySelector<HTMLButtonElement>("button[type='submit']");
      if (submit) {
        submit.disabled = false;
      }
    }
  });
}

void main();

