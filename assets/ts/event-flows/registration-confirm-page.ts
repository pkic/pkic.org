import { getJson, postJson, ApiClientError } from "../shared/api-client";
import { normalizeValidation } from "../shared/validation-map";
import { renderSharePanel } from "../shared/render-share-panel";
import { bootstrap, setStatus } from "./boot";

interface ConfirmResponse {
  success: true;
  status: string;
  shareUrl?: string | null;
  manageToken?: string | null;
}

interface ConfirmInfoResponse {
  firstName: string | null;
  eventName: string | null;
  /** True when the pending token exists but has passed its expiry time. */
  expired: boolean;
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
  eventName: string,
  shareUrl: string | null | undefined,
  manageToken: string | null | undefined,
  eventSlug: string,
): void {
  form.classList.add("d-none");

  const greeting = firstName ? `${firstName}, you're` : "You're";
  const forEvent = eventName ? ` for the ${eventName}` : "";

  const panel = document.createElement("div");
  panel.className = "event-flow-success";

  if (result.status === "waitlisted") {
    panel.innerHTML = `
      <div class="event-flow-success-icon" aria-hidden="true">📋</div>
      <h2 class="event-flow-success-title">${greeting} on the waitlist!</h2>
      <p class="event-flow-success-body">
        We have your email confirmed. We'll notify you as soon as an in-person
        spot becomes available${forEvent}. Check the email we sent you for your
        manage link.
      </p>
    `;
  } else {
    panel.innerHTML = `
      <div class="event-flow-success-icon" aria-hidden="true">🎉</div>
      <h2 class="event-flow-success-title">${greeting} registered${forEvent}!</h2>
      <p class="event-flow-success-body">Your calendar invite is on its way. Use the link in your confirmation email to manage your registration.</p>
    `;
  }

  // Share panel: highest-intent moment — the user just committed by confirming
  // their email, making this the optimal time to ask them to spread the word.
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

  const greeting = firstName ? `Hi ${firstName}!` : "Hi there!";
  const forEvent = eventName ? ` for ${eventName}` : "";

  const panel = document.createElement("div");
  panel.className = "event-flow-success";
  panel.innerHTML = `
    <div class="event-flow-success-icon" aria-hidden="true">⏰</div>
    <h2 class="event-flow-success-title">Your confirmation link has expired</h2>
    <p class="event-flow-success-body">
      ${greeting} The verification link${forEvent} is no longer valid — these
      links expire after 48&nbsp;hours for security. Click the button below and
      we'll send a fresh one to the same email address straight away.
    </p>
    <button type="button" class="btn btn-primary px-4" data-resend-btn>
      Send me a new link
    </button>
  `;
  root.appendChild(panel);

  const resendBtn = panel.querySelector<HTMLButtonElement>("[data-resend-btn]");
  resendBtn?.addEventListener("click", async () => {
    if (!resendBtn) return;
    resendBtn.disabled = true;
    resendBtn.textContent = "Sending…";

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
      resendBtn.disabled = false;
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
  let eventName = "";
  let isExpired = false;
  try {
    const info = await getJson<ConfirmInfoResponse>(
      `${boot.apiBase}/events/${boot.eventSlug}/registrations/confirm-info?token=${encodeURIComponent(token)}`,
    );
    firstName = info.firstName ?? "";
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
    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.textContent = "Confirming…";
    }

    try {
      const result = await postJson<ConfirmResponse>(
        `${boot.apiBase}/events/${boot.eventSlug}/registrations/confirm-email`,
        { token },
      );
      showConfirmedPanel(boot.root, boot.form, result, firstName, eventName, result.shareUrl, result.manageToken, boot.eventSlug);
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
        if (confirmButton) {
          confirmButton.disabled = false;
          confirmButton.textContent = "Confirm registration";
        }
      }
    }
  });
}

void main();

