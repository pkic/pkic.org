import { render, createRef } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, postJson, ApiClientError } from "../shared/api-client";
import { normalizeValidation } from "../shared/form/validation-map";
import { renderSharePanel } from "../shared/widgets/share-panel";
import { renderDonationCta } from "../shared/donation/cta";
import { withLoadingButton } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { SuccessPanel } from "../components/SuccessPanel";
import {
  hasPendingRegistrationDayWaitlist,
  RegistrationDayStatusSummary,
} from "../components/RegistrationDayStatusSummary";
import { findSubmitButton } from "../shared/form/helpers";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { TextInput } from "../ui/TextControl";
import {
  registrationConfirmInfoResponseSchema,
  registrationConfirmResponseSchema,
  okResponseSchema,
  type RegistrationConfirmResponse,
} from "../../shared/schemas/registration";

/**
 * Design system notes (phase 5):
 *
 *  - Everything this module renders goes inside `SuccessPanel`, which is
 *    already on the system and supplies the `.pk` root, so the base layer
 *    applies to the markup below without a second wrapper.
 *  - The "next steps" block was an `alert alert-light` — a box carrying no
 *    severity, which is what a `Panel` is. Its `<strong>` stand-in for a
 *    heading is now a real one, through `PanelHeader`.
 *  - The resend panel reports its own outcome instead of writing into the
 *    page-level `[data-flow-status]` banner. A missing address is a `Field`
 *    state, so it carries `aria-invalid` and `aria-describedby` on the control
 *    the reader is standing in; a refused request is an `Alert` beside the
 *    button. Routing both through `setStatus` announced them from the bottom
 *    of the page and repainted that element with Bootstrap's `alert-danger`.
 *  - The resend button keeps one accessible name in every state. Relabelling
 *    it "Try again" on failure moves the control's name under the reader's
 *    cursor mid-interaction; the Alert already says what went wrong.
 *  - Visibility uses the `hidden` property wherever this module owns both
 *    sides. `[data-confirm-content]` is the exception, commented at its use.
 */

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

/** The manage-registration links, which differ when days are still pending. */
function NextSteps({ manageUrl, hasPartialDayWaitlist }: { manageUrl: string; hasPartialDayWaitlist: boolean }) {
  return (
    <Panel class="pk-start">
      <PanelHeader title="Next steps" />
      <PanelBody class="pk-stack pk-stack--snug">
        {hasPartialDayWaitlist ? (
          <>
            <p class="pk-small">
              Review your confirmed and pending days, then decide whether to keep this registration, change attendance
              for a day, or cancel entirely.
            </p>
            <div class="pk-cluster">
              <a class="pk-btn pk-btn--secondary pk-btn--sm" href={manageUrl}>
                Review or change registration
              </a>
            </div>
          </>
        ) : (
          <div class="pk-cluster">
            <a class="pk-btn pk-btn--secondary pk-btn--sm" href={manageUrl}>
              Manage registration
            </a>
            <a class="pk-btn pk-btn--secondary pk-btn--sm" href={`${manageUrl}#manage-headshot-file`}>
              Upload headshot
            </a>
          </div>
        )}
      </PanelBody>
    </Panel>
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
  result: RegistrationConfirmResponse,
  firstName: string,
  lastName: string,
  eventName: string,
  email: string,
  organizationName: string,
  shareUrl: string | null | undefined,
  manageUrl: string,
  manageToken: string | null | undefined,
  eventSlug: string,
): void {
  form.hidden = true;

  const successTitle = root.dataset["successTitle"] ?? "{firstName}, you're registered{forEvent}!";
  const successBody =
    root.dataset["successBody"] ??
    "Your calendar invite is on its way. Use the link in your confirmation email to manage your registration.";
  const partialWaitlistTitle =
    root.dataset["partialWaitlistTitle"] ?? "{firstName}, your registration is in place{forEvent}!";
  const partialWaitlistBody =
    root.dataset["partialWaitlistBody"] ??
    "Your overall registration is confirmed, but one or more selected in-person days are still pending because those rooms are at capacity right now.";
  const hasPartialDayWaitlist =
    result.status === "registered" && hasPendingRegistrationDayWaitlist(result.dayWaitlist ?? []);

  let icon: string;
  let title: string;
  let bodyContent: preact.JSX.Element;

  if (hasPartialDayWaitlist) {
    icon = "🗓️";
    title = interpolate(partialWaitlistTitle, firstName, eventName);
    bodyContent = (
      <>
        <p class="pk-muted">{interpolate(partialWaitlistBody, firstName, eventName)}</p>
        <RegistrationDayStatusSummary
          dayAttendance={result.dayAttendance ?? []}
          dayWaitlist={result.dayWaitlist ?? []}
        />
      </>
    );
  } else {
    icon = "🎉";
    title = interpolate(successTitle, firstName, eventName);
    bodyContent = <p class="pk-muted">{interpolate(successBody, firstName, eventName)}</p>;
  }

  const container = document.createElement("div");
  const shareRef = createRef<HTMLDivElement>();
  const donateRef = createRef<HTMLDivElement>();

  render(
    <SuccessPanel icon={icon} title={title}>
      {bodyContent}
      <NextSteps manageUrl={manageUrl} hasPartialDayWaitlist={hasPartialDayWaitlist} />
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

/** What went wrong, and which control the reader should be pointed at. */
interface ResendProblem {
  scope: "email" | "request";
  message: string;
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
  email,
  autoSend = false,
}: {
  apiBase: string;
  eventSlug: string;
  token: string;
  registrationId: string | null;
  email: string;
  autoSend?: boolean;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [enteredEmail, setEnteredEmail] = useState(email);
  const [problem, setProblem] = useState<ResendProblem | null>(null);

  const sendFreshLink = useCallback(async () => {
    const recoveryEmail = (email || enteredEmail).trim();
    if (!registrationId && !email && !recoveryEmail) {
      setProblem({ scope: "email", message: "Enter the email address you used for registration." });
      setState("error");
      return;
    }
    setState("sending");
    setProblem(null);
    try {
      await postJson(
        `${apiBase}/events/${eventSlug}/registrations/resend-confirmation`,
        {
          ...(registrationId ? { id: registrationId } : {}),
          token,
          ...(recoveryEmail ? { email: recoveryEmail } : {}),
        },
        okResponseSchema,
      );
      setState("sent");
    } catch (error) {
      setProblem({ scope: "request", message: normalizeValidation(error).globalMessage });
      setState("error");
    }
  }, [apiBase, email, enteredEmail, eventSlug, registrationId, token]);

  useEffect(() => {
    if (autoSend && state === "idle") {
      void sendFreshLink();
    }
  }, [autoSend, sendFreshLink, state]);

  if (state === "sent") {
    return <Alert tone="ok">A new confirmation link is on its way — please check your inbox (and spam folder).</Alert>;
  }

  const requestProblem = problem?.scope === "request" ? problem.message : null;
  const emailProblem = problem?.scope === "email" ? problem.message : null;

  if (!email && !registrationId) {
    return (
      <form
        class="pk-stack pk-stack--snug pk-start"
        onSubmit={(event) => {
          event.preventDefault();
          void sendFreshLink();
        }}
      >
        <Field
          label="Email address"
          required
          state={emailProblem ? "invalid" : undefined}
          message={emailProblem ?? undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              type="email"
              autocomplete="email"
              value={enteredEmail}
              onInput={(event) => setEnteredEmail((event.currentTarget as HTMLInputElement).value)}
            />
          )}
        </Field>
        {requestProblem && <Alert tone="danger">{requestProblem}</Alert>}
        <div class="pk-cluster">
          <Button type="submit" variant="primary" loading={state === "sending"}>
            Send me a new link
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div class="pk-stack pk-stack--snug">
      {requestProblem && <Alert tone="danger">{requestProblem}</Alert>}
      <div class="pk-cluster pk-cluster--center">
        <Button variant="primary" loading={state === "sending"} onClick={() => void sendFreshLink()}>
          Send me a new link
        </Button>
      </div>
    </div>
  );
}

function showExpiredPanel(
  root: HTMLElement,
  form: HTMLFormElement,
  apiBase: string,
  eventSlug: string,
  token: string,
  registrationId: string | null,
  firstName: string,
  eventName: string,
  email: string,
): void {
  form.hidden = true;

  const expiredTitle = root.dataset["expiredTitle"] ?? "Your confirmation link needs refreshing";
  const expiredBody =
    root.dataset["expiredBody"] ??
    "The verification link{forEvent} is no longer current. We'll send a fresh one to the email address used for this registration.";

  const greeting = firstName ? `Hi ${firstName}!` : "Hi there!";
  const title = interpolate(expiredTitle, firstName, eventName);

  const container = document.createElement("div");
  render(
    <SuccessPanel icon="⏰" title={title}>
      <p class="pk-muted">
        {greeting} {interpolate(expiredBody, firstName, eventName)}
      </p>
      <ResendButton
        apiBase={apiBase}
        eventSlug={eventSlug}
        token={token}
        registrationId={registrationId}
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

  // The template hides this with the `hidden` attribute, so revealing it is
  // the platform's own mechanism and no class has to be kept in step.
  const revealContent = (): void => {
    if (contentEl) contentEl.hidden = false;
  };

  const token = boot.query.token;
  const registrationId = boot.query.id;
  if (!token) {
    if (loadingEl) loadingEl.hidden = true;
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
    const info = await getJson(
      `${boot.apiBase}/events/${boot.eventSlug}/registrations/confirm-info?token=${encodeURIComponent(token)}${registrationId ? `&id=${encodeURIComponent(registrationId)}` : ""}`,
      registrationConfirmInfoResponseSchema,
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
    if (loadingEl) loadingEl.hidden = true;
    // We need the form reference — reveal content briefly to get the element
    // then let showExpiredPanel hide it again.
    revealContent();
    showExpiredPanel(
      boot.root,
      boot.form,
      boot.apiBase,
      boot.eventSlug,
      token,
      registrationId,
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

  if (loadingEl) loadingEl.hidden = true;
  revealContent();

  boot.form.addEventListener("submit", async (event) => {
    event.preventDefault();

    await withLoadingButton(findSubmitButton(boot.form), async () => {
      try {
        const result = await postJson(
          `${boot.apiBase}/events/${boot.eventSlug}/registrations/confirm-email`,
          {
            token,
            ...(registrationId ? { id: registrationId } : {}),
          },
          registrationConfirmResponseSchema,
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
