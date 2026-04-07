import { getJson, postJson, ApiClientError } from "../shared/api-client";
import { setButtonLoading, resetButton } from "../shared/button-loading";
import { normalizeValidation } from "../shared/validation-map";
import { renderSharePanel } from "../shared/render-share-panel";
import { renderDonationCta } from "../shared/render-donation-cta";
import { bootstrap, setStatus } from "./boot";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface ConfirmResponse {
  success: true;
  status: string;
  shareUrl?: string | null;
  manageUrl?: string | null;
  manageToken?: string | null;
  dayAttendance?: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist?: Array<{ dayDate: string; status: string }>;
}

interface ConfirmInfoResponse {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  organizationName: string | null;
  eventName: string | null;
  /** True when the pending token exists but has passed its expiry time. */
  expired: boolean;
}

/**
 * Replace {firstName}, {eventName} and {forEvent} tokens in a template string
 * with the actual values. All substituted values are plain text, not HTML —
 * the caller is responsible for escaping before inserting into innerHTML.
 */
function interpolate(template: string, firstName: string, eventName: string): string {
  const forEvent = eventName ? ` for the ${eventName}` : "";
  return template
    .replace(/\{firstName\}/g, firstName || "You")
    .replace(/\{eventName\}/g, eventName || "")
    .replace(/\{forEvent\}/g, forEvent);
}

/**
 * Fill [data-placeholder="key"] elements inside root with API-fetched values.
 * Targets only the specific elements authored in the shortcode — no full-DOM
 * scan needed, and no raw tokens are ever sent to the browser.
 */
function fillPlaceholders(root: HTMLElement, values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    root.querySelectorAll<HTMLElement>(`[data-placeholder="${key}"]`).forEach((el) => {
      el.textContent = value;
    });
  }
}

function isPendingDayWaitlistStatus(status: string | undefined): boolean {
  return status === "waiting" || status === "offered";
}

function buildDayStatusSummary(
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>,
  dayWaitlist: Array<{ dayDate: string; status: string }>,
): string {
  if (dayAttendance.length === 0) {
    return "";
  }

  const waitlistByDay = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry.status] as const));
  const rows = dayAttendance.map((entry) => {
    const dayLabel = entry.label ?? entry.dayDate;
    const waitlistStatus = waitlistByDay.get(entry.dayDate);

    let statusLabel: string;
    let statusClass = "text-bg-success";

    if (waitlistStatus === "offered") {
      statusLabel = "Spot available - review in manage page";
      statusClass = "text-bg-info";
    } else if (waitlistStatus === "waiting") {
      statusLabel = "In-person still pending";
      statusClass = "text-bg-warning";
    } else if (entry.attendanceType === "virtual") {
      statusLabel = "Virtual confirmed";
    } else if (entry.attendanceType === "on_demand") {
      statusLabel = "On-demand confirmed";
    } else {
      statusLabel = "In-person confirmed";
    }

    return `<li class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2"><span>${escapeHtml(dayLabel)}</span><span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span></li>`;
  }).join("");

  return `
    <div class="alert alert-warning mt-3 mb-0">
      <p class="fw-semibold mb-2">What is confirmed right now</p>
      <ul class="list-unstyled mb-2">${rows}</ul>
      <p class="small mb-0">If this mix of confirmed and pending days no longer works for you, use the manage page to switch days, move to on-demand, or cancel the registration.</p>
    </div>
  `;
}

/**
 * Psychology applied:
 * - Peak-End Rule: the confirmation success is the emotional peak — pairing it
 *   with the share link makes sharing the most natural next action.
 * - Goal-Gradient: completing the confirmation "unlocks" the share panel,
 *   making the user feel they've earned the privilege to invite others.
 */
function showConfirmedPanel(
  root: HTMLElement,
  form: HTMLFormElement,
  result: ConfirmResponse,
  firstName: string,
  lastName: string,
  eventName: string,
  email: string,
  organizationName: string,
  shareUrl: string | null | undefined,
  manageUrl: string | null | undefined,
  manageToken: string | null | undefined,
  eventSlug: string,
): void {
  form.classList.add("d-none");

  const successTitle  = root.dataset["successTitle"]  ?? "{firstName}, you're registered{forEvent}!";
  const successBody   = root.dataset["successBody"]   ?? "Your calendar invite is on its way. Use the link in your confirmation email to manage your registration.";
  const waitlistTitle = root.dataset["waitlistTitle"] ?? "{firstName}, you're on the waitlist{forEvent}!";
  const waitlistBody  = root.dataset["waitlistBody"]  ?? "We have your email confirmed. We'll notify you as soon as an in-person spot becomes available. Check the email we sent you for your manage link.";
  const partialWaitlistTitle = root.dataset["partialWaitlistTitle"] ?? "{firstName}, your registration is in place{forEvent}!";
  const partialWaitlistBody = root.dataset["partialWaitlistBody"] ?? "Your overall registration is confirmed, but one or more selected in-person days are still pending because those rooms are at capacity right now.";
  const activeDayWaitlist = (result.dayWaitlist ?? []).filter((entry) => isPendingDayWaitlistStatus(entry.status));
  const hasPartialDayWaitlist = result.status === "registered" && activeDayWaitlist.length > 0;

  const panel = document.createElement("div");
  panel.className = "event-flow-success";

  if (result.status === "waitlisted") {
    panel.innerHTML = `
      <div class="event-flow-success-icon" aria-hidden="true">📋</div>
      <h2 class="event-flow-success-title">${escapeHtml(interpolate(waitlistTitle, firstName, eventName))}</h2>
      <p class="event-flow-success-body">${escapeHtml(interpolate(waitlistBody, firstName, eventName))}</p>
    `;
  } else if (hasPartialDayWaitlist) {
    panel.innerHTML = `
      <div class="event-flow-success-icon" aria-hidden="true">🗓️</div>
      <h2 class="event-flow-success-title">${escapeHtml(interpolate(partialWaitlistTitle, firstName, eventName))}</h2>
      <p class="event-flow-success-body">${escapeHtml(interpolate(partialWaitlistBody, firstName, eventName))}</p>
      ${buildDayStatusSummary(result.dayAttendance ?? [], result.dayWaitlist ?? [])}
    `;
  } else {
    panel.innerHTML = `
      <div class="event-flow-success-icon" aria-hidden="true">🎉</div>
      <h2 class="event-flow-success-title">${escapeHtml(interpolate(successTitle, firstName, eventName))}</h2>
      <p class="event-flow-success-body">${escapeHtml(interpolate(successBody, firstName, eventName))}</p>
    `;
  }

  // Share panel: highest-intent moment — the user just committed by confirming
  // their email, making this the optimal time to ask them to spread the word.
  if (manageUrl || manageToken) {
    const fallbackManageUrl = manageToken
      ? `/events/${encodeURIComponent(eventSlug)}/register/manage/?event=${encodeURIComponent(eventSlug)}&token=${encodeURIComponent(manageToken)}`
      : null;
    const effectiveManageUrl = manageUrl ?? fallbackManageUrl;

    const quickActions = document.createElement("div");
    quickActions.className = "alert alert-light mt-3";
    quickActions.innerHTML = hasPartialDayWaitlist
      ? `
        <p class="mb-2"><strong>Next steps</strong></p>
        <p class="small mb-2">Review your confirmed and pending days, then decide whether to keep this registration, change attendance for a day, or cancel entirely.</p>
        <div class="d-flex gap-2 flex-wrap">
          <a class="btn btn-sm btn-outline-primary" href="${escapeHtml(effectiveManageUrl ?? "")}">Review or change registration</a>
        </div>
      `
      : `
        <p class="mb-2"><strong>Next steps</strong></p>
        <div class="d-flex gap-2 flex-wrap">
          <a class="btn btn-sm btn-outline-primary" href="${escapeHtml(effectiveManageUrl ?? "")}">Manage registration</a>
          <a class="btn btn-sm btn-outline-secondary" href="${escapeHtml(effectiveManageUrl ?? "")}#manage-headshot-file">Upload headshot</a>
        </div>
      `;
    panel.appendChild(quickActions);
  }

  if (shareUrl) {
    const shareContainer = document.createElement("div");
    renderSharePanel(shareContainer, {
      shareUrl,
      eventName: eventName || root.dataset["eventSlug"] || "",
      firstName: firstName || undefined,
      manageToken: manageToken ?? null,
      eventSlug: eventSlug || null,
    });
    panel.appendChild(shareContainer);
  }

  // Donation CTA — placed after the share panel at the emotional peak.
  const donorName = [firstName, lastName].filter(Boolean).join(" ") || undefined;
  renderDonationCta(panel, {
    name: donorName,
    email: email || undefined,
    organizationName: organizationName || undefined,
  });

  root.appendChild(panel);
}

/**
 * Replace the confirm form with a "link expired" panel that lets the attendee
 * request a fresh confirmation email without leaving the page.
 */
function showExpiredPanel(
  root: HTMLElement,
  form: HTMLFormElement,
  apiBase: string,
  eventSlug: string,
  token: string,
  statusEl: HTMLElement,
  firstName: string,
  eventName: string,
): void {
  form.classList.add("d-none");

  const expiredTitle = root.dataset["expiredTitle"] ?? "Your confirmation link has expired";
  const expiredBody  = root.dataset["expiredBody"]  ?? "The verification link{forEvent} is no longer valid — these links expire after 48 hours for security. Click the button below and we'll send a fresh one to the same email address.";

  const greeting = firstName ? `Hi ${firstName}!` : "Hi there!";

  const panel = document.createElement("div");
  panel.className = "event-flow-success";
  panel.innerHTML = `
    <div class="event-flow-success-icon" aria-hidden="true">⏰</div>
    <h2 class="event-flow-success-title">${escapeHtml(interpolate(expiredTitle, firstName, eventName))}</h2>
    <p class="event-flow-success-body">
      ${escapeHtml(greeting)} ${escapeHtml(interpolate(expiredBody, firstName, eventName))}
    </p>
    <button type="button" class="btn btn-primary px-4" data-resend-btn>
      Send me a new link
    </button>
  `;
  root.appendChild(panel);

  const resendBtn = panel.querySelector<HTMLButtonElement>("[data-resend-btn]");
  resendBtn?.addEventListener("click", async () => {
    if (!resendBtn) return;
    setButtonLoading(resendBtn);

    try {
      await postJson(
        `${apiBase}/events/${eventSlug}/registrations/resend-confirmation`,
        { token },
      );
      resendBtn.remove();
      const successMsg = document.createElement("p");
      successMsg.className = "alert alert-success mt-3";
      successMsg.textContent =
        "A new confirmation link is on its way — please check your inbox (and spam folder).";
      panel.appendChild(successMsg);
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(statusEl, normalized.globalMessage, true);
      resetButton(resendBtn);
      resendBtn.textContent = "Try again";
    }
  });
}

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-registration-confirm]");
  if (!boot) {
    return;
  }

  const loadingEl = boot.root.querySelector<HTMLElement>("[data-confirm-loading]");
  const contentEl = boot.root.querySelector<HTMLElement>("[data-confirm-content]");

  const token = boot.query.token;
  if (!token) {
    loadingEl?.classList.add("d-none");
    setStatus(boot.statusEl, "Missing confirmation token — please use the link from your email.", true);
    return;
  }

  // Fetch first name and event name from the read-only info endpoint.
  // The skeleton stays visible during this fetch so the user never sees raw
  // placeholder tokens — [data-placeholder] elements are filled before reveal.
  let firstName = "";
  let lastName = "";
  let email = "";
  let organizationName = "";
  let eventName = "";
  let isExpired = false;
  try {
    const info = await getJson<ConfirmInfoResponse>(
      `${boot.apiBase}/events/${boot.eventSlug}/registrations/confirm-info?token=${encodeURIComponent(token)}`,
    );
    firstName = info.firstName ?? "";
    lastName = info.lastName ?? "";
    email = info.email ?? "";
    organizationName = info.organizationName ?? "";
    eventName = info.eventName ?? "";
    isExpired = info.expired ?? false;
  } catch {
    // Non-critical — page degrades to default placeholder text
  }

  // If the token is already expired before the user clicks Confirm, show the
  // resend panel immediately rather than making them click through to an error.
  if (isExpired) {
    loadingEl?.classList.add("d-none");
    // We need the form reference — reveal content briefly to get the element
    // then let showExpiredPanel hide it again.
    contentEl?.classList.remove("d-none");
    showExpiredPanel(
      boot.root,
      boot.form,
      boot.apiBase,
      boot.eventSlug,
      token,
      boot.statusEl,
      firstName,
      eventName,
    );
    return;
  }

  // Fill [data-placeholder] elements, then swap skeleton → content.
  const fills: Record<string, string> = {};
  if (firstName) fills["firstName"] = firstName;
  if (eventName) fills["eventName"] = eventName;
  fillPlaceholders(boot.root, fills);

  loadingEl?.classList.add("d-none");
  contentEl?.classList.remove("d-none");

  const confirmButton = boot.form.querySelector<HTMLButtonElement>("button[type='submit']");
  boot.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (confirmButton) setButtonLoading(confirmButton);

    try {
      const result = await postJson<ConfirmResponse>(
        `${boot.apiBase}/events/${boot.eventSlug}/registrations/confirm-email`,
        { token },
      );
      showConfirmedPanel(boot.root, boot.form, result, firstName, lastName, eventName, email, organizationName, result.shareUrl, result.manageUrl, result.manageToken, boot.eventSlug);
    } catch (error) {
      // If the link expired between page load and click, replace form with
      // the resend panel rather than just showing an error alert.
      const normalized = normalizeValidation(error);
      if (error instanceof ApiClientError && error.code === "CONFIRM_TOKEN_EXPIRED") {
        showExpiredPanel(
          boot.root,
          boot.form,
          boot.apiBase,
          boot.eventSlug,
          token,
          boot.statusEl,
          firstName,
          eventName,
        );
      } else {
        setStatus(boot.statusEl, normalized.globalMessage, true);
        if (confirmButton) resetButton(confirmButton);
      }
    }
  });
}

void main();

