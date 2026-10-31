import { render, createRef, type ComponentChildren } from "preact";
import type { RegistrationSubmissionResponse } from "../../shared/schemas/registration";
import { REGISTRATION_ORGANIZATION_COPY } from "../../shared/email-first-copy";
import { Alert } from "../ui/Alert";
import { SuccessPanel } from "../components/SuccessPanel";
import { PersonalAddressPrompt } from "../components/events/PersonalAddressPrompt";
import {
  hasPendingRegistrationDayWaitlist,
  RegistrationDayStatusSummary,
} from "../components/RegistrationDayStatusSummary";
import { renderSharePanel } from "../shared/widgets/share-panel";
import { renderDonationCta } from "../shared/donation/cta";

function formatSubmittedEmail(email: string): ComponentChildren {
  return <span class="event-flow-address">{email || "the email address you entered"}</span>;
}

export function showRegistrationSuccess(
  root: HTMLElement,
  form: HTMLFormElement,
  result: RegistrationSubmissionResponse,
  firstName: string,
  lastName: string,
  email: string,
  organization: string,
  eventName: string,
  eventSlug: string,
): void {
  // The form's markup no longer
  // carries Bootstrap, so `d-none` would stop hiding it the moment that page
  // drops `main.scss`. The stepper below already uses the platform attribute;
  // the form now does too.
  form.hidden = true;
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
    // Only a submission without a verified address waits; the browser verifies first, so this is the exception.
    icon = "";
    title = "Check your email";
    body = (
      <Alert tone="info">
        Open the link we sent to {formatSubmittedEmail(email)} to confirm your registration. Your place is held only
        after you confirm.
      </Alert>
    );
  } else if (hasPendingRegistrationDayWaitlist(result.dayWaitlist)) {
    icon = "🗓️";
    title = "Your registration is in place";
    showShare = !!result.shareUrl;
    body = (
      <>
        {/* The link is a sibling of the sentence rather than a block-level
            anchor inside it: the stack's gap is what separates them, and a
            paragraph is no longer asked to contain a block. */}
        <div class="pk-stack pk-stack--snug">
          <p class="event-flow-success-body">
            Your overall registration is confirmed, but one or more selected in-person days are still pending because
            those rooms are at capacity.
          </p>
          {result.manageUrl && <a href={result.manageUrl}>Review or change registration</a>}
        </div>
        <RegistrationDayStatusSummary dayAttendance={result.dayAttendance} dayWaitlist={result.dayWaitlist} />
        <PersonalAddressPrompt email={email} waiting />
      </>
    );
  } else {
    icon = "🎉";
    title = `You're registered${firstName ? `, ${firstName}` : ""}!`;
    showShare = !!result.shareUrl;
    body = (
      <>
        <p class="event-flow-success-body">
          A confirmation email with your calendar invite is on its way.{" "}
          {result.manageUrl && <a href={result.manageUrl}>Manage your registration</a>}
        </p>
        <PersonalAddressPrompt email={email} />
      </>
    );
  }
  const organizationNote =
    result.organizationOutcome === "review_required" ? (
      <Alert tone="info">{REGISTRATION_ORGANIZATION_COPY.reviewRequired}</Alert>
    ) : null;

  const container = document.createElement("div");
  const shareRef = createRef<HTMLDivElement>();
  const donateRef = createRef<HTMLDivElement>();

  render(
    <SuccessPanel icon={icon} title={title}>
      {body}
      {organizationNote}
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
      waitlisted: hasPendingRegistrationDayWaitlist(result.dayWaitlist),
    });
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (donateRef.current) {
    renderDonationCta(donateRef.current, {
      name: fullName || undefined,
      email,
      organizationName: organization || undefined,
      source: window.location.pathname,
    });
  }

  root.appendChild(container);
  requestAnimationFrame(() => {
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
