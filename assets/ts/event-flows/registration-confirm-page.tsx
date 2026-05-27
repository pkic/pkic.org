import { render, createRef } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, postJson, ApiClientError } from "../shared/api-client";
import { normalizeValidation } from "../shared/form/validation-map";
import { renderSharePanel } from "../shared/widgets/share-panel";
import { renderDonationCta } from "../shared/donation/cta";
import { withLoadingButton } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { SuccessPanel } from "../components/SuccessPanel";
import { findSubmitButton } from "../shared/form/helpers";

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
  recoverable?: boolean;
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

function DayStatusSummary({
  dayAttendance,
  dayWaitlist,
}: {
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist: Array<{ dayDate: string; status: string }>;
}) {
  if (dayAttendance.length === 0) return null;

  const waitlistByDay = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry.status] as const));

  return (
    <div class="alert alert-warning mt-3 mb-0">
      <p class="fw-semibold mb-2">What is confirmed right now</p>
      <ul class="list-unstyled mb-2">
        {dayAttendance.map((entry) => {
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

          return (
            <li class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
              <span>{dayLabel}</span>
              <span class={`badge ${statusClass}`}>{statusLabel}</span>
            </li>
          );
        })}
      </ul>
      <p class="small mb-0">
        If this mix of confirmed and pending days no longer works for you, use the manage page to switch days, move to
        on-demand, or cancel the registration.
      </p>
    </div>
  );
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

  const successTitle = root.dataset["successTitle"] ?? "{firstName}, you're registered{forEvent}!";
  const successBody =
    root.dataset["successBody"] ??
    "Your calendar invite is on its way. Use the link in your confirmation email to manage your registration.";
  const waitlistTitle = root.dataset["waitlistTitle"] ?? "{firstName}, you're on the waitlist{forEvent}!";
  const waitlistBody =
    root.dataset["waitlistBody"] ??
    "We have your email confirmed. We'll notify you as soon as an in-person spot becomes available. Check the email we sent you for your manage link.";
  const partialWaitlistTitle =
    root.dataset["partialWaitlistTitle"] ?? "{firstName}, your registration is in place{forEvent}!";
  const partialWaitlistBody =
    root.dataset["partialWaitlistBody"] ??
    "Your overall registration is confirmed, but one or more selected in-person days are still pending because those rooms are at capacity right now.";
  const activeDayWaitlist = (result.dayWaitlist ?? []).filter((entry) => isPendingDayWaitlistStatus(entry.status));
  const hasPartialDayWaitlist = result.status === "registered" && activeDayWaitlist.length > 0;

  let icon: string;
  let title: string;
  let bodyContent: preact.JSX.Element;

  if (result.status === "waitlisted") {
    icon = "📋";
    title = interpolate(waitlistTitle, firstName, eventName);
    bodyContent = <p class="event-flow-success-body">{interpolate(waitlistBody, firstName, eventName)}</p>;
  } else if (hasPartialDayWaitlist) {
    icon = "🗓️";
    title = interpolate(partialWaitlistTitle, firstName, eventName);
    bodyContent = (
      <>
        <p class="event-flow-success-body">{interpolate(partialWaitlistBody, firstName, eventName)}</p>
        <DayStatusSummary dayAttendance={result.dayAttendance ?? []} dayWaitlist={result.dayWaitlist ?? []} />
      </>
    );
  } else {
    icon = "🎉";
    title = interpolate(successTitle, firstName, eventName);
    bodyContent = <p class="event-flow-success-body">{interpolate(successBody, firstName, eventName)}</p>;
  }

  const effectiveManageUrl =
    manageUrl ??
    (manageToken
      ? `/events/${encodeURIComponent(eventSlug)}/register/manage/?event=${encodeURIComponent(eventSlug)}&token=${encodeURIComponent(manageToken)}`
      : null);

  const container = document.createElement("div");
  const shareRef = createRef<HTMLDivElement>();
  const donateRef = createRef<HTMLDivElement>();

  render(
    <SuccessPanel icon={icon} title={title}>
      {bodyContent}
      {effectiveManageUrl && (
        <div class="alert alert-light mt-3">
          <p class="mb-2">
            <strong>Next steps</strong>
          </p>
          {hasPartialDayWaitlist ? (
            <>
              <p class="small mb-2">
                Review your confirmed and pending days, then decide whether to keep this registration, change attendance
                for a day, or cancel entirely.
              </p>
              <div class="d-flex gap-2 flex-wrap">
                <a class="btn btn-sm btn-outline-primary" href={effectiveManageUrl}>
                  Review or change registration
                </a>
              </div>
            </>
          ) : (
            <div class="d-flex gap-2 flex-wrap">
              <a class="btn btn-sm btn-outline-primary" href={effectiveManageUrl}>
                Manage registration
              </a>
              <a class="btn btn-sm btn-outline-secondary" href={`${effectiveManageUrl}#manage-headshot-file`}>
                Upload headshot
              </a>
            </div>
          )}
        </div>
      )}
      {shareUrl && <div ref={shareRef} />}
      <div ref={donateRef} />
    </SuccessPanel>,
    container,
  );

  if (shareUrl && shareRef.current) {
    renderSharePanel(shareRef.current, {
      shareUrl,
      eventName: eventName || root.dataset["eventSlug"] || "",
      firstName: firstName || undefined,
      manageToken: manageToken ?? null,
      eventSlug: eventSlug || null,
    });
  }

  const donorName = [firstName, lastName].filter(Boolean).join(" ") || undefined;
  if (donateRef.current) {
    renderDonationCta(donateRef.current, {
      name: donorName,
      email: email || undefined,
      organizationName: organizationName || undefined,
    });
  }

  root.appendChild(container);
}

/**
 * Replace the confirm form with a "link expired" panel that lets the attendee
 * request a fresh confirmation email without leaving the page.
 */
function ResendButton({
  apiBase,
  eventSlug,
  token,
  registrationId,
  statusEl,
  email,
  autoSend = false,
}: {
  apiBase: string;
  eventSlug: string;
  token: string;
  registrationId: string | null;
  statusEl: HTMLElement;
  email: string;
  autoSend?: boolean;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [enteredEmail, setEnteredEmail] = useState(email);

  const sendFreshLink = useCallback(async () => {
    const recoveryEmail = (email || enteredEmail).trim();
    if (!registrationId && !email && !recoveryEmail) {
      setStatus(statusEl, "Enter the email address you used for registration.", true);
      return;
    }
    setState("sending");
    try {
      await postJson(`${apiBase}/events/${eventSlug}/registrations/resend-confirmation`, {
        ...(registrationId ? { id: registrationId } : {}),
        token,
        ...(recoveryEmail ? { email: recoveryEmail } : {}),
      });
      setState("sent");
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(statusEl, normalized.globalMessage, true);
      setState("error");
    }
  }, [apiBase, email, enteredEmail, eventSlug, registrationId, statusEl, token]);

  useEffect(() => {
    if (autoSend && state === "idle") {
      void sendFreshLink();
    }
  }, [autoSend, sendFreshLink, state]);

  if (state === "sent") {
    return (
      <p class="alert alert-success mt-3">
        A new confirmation link is on its way — please check your inbox (and spam folder).
      </p>
    );
  }

  if (!email && !registrationId) {
    return (
      <form
        class="mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void sendFreshLink();
        }}
      >
        <label class="form-label" for="confirmation-recovery-email">
          Email address
        </label>
        <div class="d-flex gap-2 flex-wrap">
          <input
            id="confirmation-recovery-email"
            class="form-control"
            type="email"
            autocomplete="email"
            value={enteredEmail}
            onInput={(event) => setEnteredEmail((event.currentTarget as HTMLInputElement).value)}
            required
          />
          <button type="submit" class="btn btn-primary px-4" disabled={state === "sending"}>
            {state === "error" ? "Try again" : "Send me a new link"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <button type="button" class="btn btn-primary px-4" onClick={sendFreshLink} disabled={state === "sending"}>
      {state === "error" ? "Try again" : "Send me a new link"}
    </button>
  );
}

function showExpiredPanel(
  root: HTMLElement,
  form: HTMLFormElement,
  apiBase: string,
  eventSlug: string,
  token: string,
  registrationId: string | null,
  statusEl: HTMLElement,
  firstName: string,
  eventName: string,
  email: string,
): void {
  form.classList.add("d-none");

  const expiredTitle = root.dataset["expiredTitle"] ?? "Your confirmation link needs refreshing";
  const expiredBody =
    root.dataset["expiredBody"] ??
    "The verification link{forEvent} is no longer current. We'll send a fresh one to the email address used for this registration.";

  const greeting = firstName ? `Hi ${firstName}!` : "Hi there!";
  const title = interpolate(expiredTitle, firstName, eventName);

  const container = document.createElement("div");
  render(
    <SuccessPanel icon="⏰" title={title}>
      <p class="event-flow-success-body">
        {greeting} {interpolate(expiredBody, firstName, eventName)}
      </p>
      <ResendButton
        apiBase={apiBase}
        eventSlug={eventSlug}
        token={token}
        registrationId={registrationId}
        statusEl={statusEl}
        email={email}
        autoSend={Boolean(email || registrationId)}
      />
    </SuccessPanel>,
    container,
  );
  root.appendChild(container);
}

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-registration-confirm]");
  if (!boot) {
    return;
  }

  const loadingEl = boot.root.querySelector<HTMLElement>("[data-confirm-loading]");
  const contentEl = boot.root.querySelector<HTMLElement>("[data-confirm-content]");

  const token = boot.query.token;
  const registrationId = boot.query.id;
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
  let isRecoverable = false;
  try {
    const info = await getJson<ConfirmInfoResponse>(
      `${boot.apiBase}/events/${boot.eventSlug}/registrations/confirm-info?token=${encodeURIComponent(token)}${registrationId ? `&id=${encodeURIComponent(registrationId)}` : ""}`,
    );
    firstName = info.firstName ?? "";
    lastName = info.lastName ?? "";
    email = info.email ?? "";
    organizationName = info.organizationName ?? "";
    eventName = info.eventName ?? "";
    isExpired = info.expired ?? false;
    isRecoverable = info.recoverable ?? false;
  } catch {
    // Non-critical — page degrades to default placeholder text
  }

  // If the token is already expired before the user clicks Confirm, show the
  // resend panel immediately rather than making them click through to an error.
  if (isExpired || isRecoverable) {
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
      registrationId,
      boot.statusEl,
      firstName,
      eventName,
      email,
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

  boot.form.addEventListener("submit", async (event) => {
    event.preventDefault();

    await withLoadingButton(findSubmitButton(boot.form), async () => {
      try {
        const result = await postJson<ConfirmResponse>(
          `${boot.apiBase}/events/${boot.eventSlug}/registrations/confirm-email`,
          { token, ...(registrationId ? { id: registrationId } : {}) },
        );
        showConfirmedPanel(
          boot.root,
          boot.form,
          result,
          firstName,
          lastName,
          eventName,
          email,
          organizationName,
          result.shareUrl,
          result.manageUrl,
          result.manageToken,
          boot.eventSlug,
        );
      } catch (error) {
        const normalized = normalizeValidation(error);
        if (
          error instanceof ApiClientError &&
          (error.code === "CONFIRM_TOKEN_EXPIRED" || error.code === "CONFIRM_TOKEN_INVALID")
        ) {
          showExpiredPanel(
            boot.root,
            boot.form,
            boot.apiBase,
            boot.eventSlug,
            token,
            registrationId,
            boot.statusEl,
            firstName,
            eventName,
            email,
          );
        } else {
          setStatus(boot.statusEl, normalized.globalMessage, true);
        }
      }
    });
  });
}

void main();
