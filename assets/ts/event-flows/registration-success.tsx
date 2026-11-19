import { render, createRef, type ComponentChildren } from "preact";
import type { RegistrationSubmissionResponse } from "../../shared/schemas/registration";
import { SuccessPanel } from "../components/SuccessPanel";
import { PersonalAddressPrompt } from "../components/events/PersonalAddressPrompt";
import {
  hasPendingRegistrationDayWaitlist,
  RegistrationDayStatusSummary,
} from "../components/RegistrationDayStatusSummary";
import { renderSharePanel } from "../shared/widgets/share-panel";
import { renderDonationCta } from "../shared/donation/cta";
import { eventParticipantRecordPath } from "../../shared/event-participant-paths";

export function showRegistrationSuccess(
  root: HTMLElement,
  form: HTMLFormElement,
  result: RegistrationSubmissionResponse,
  firstName: string,
  lastName: string,
  email: string,
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
  const showShare = !!result.shareUrl;
  // Every registrant is signed in and manages the registration in the portal.
  const manageHref = `/portal/#${eventParticipantRecordPath(eventSlug, "registration", result.registrationId)}`;

  if (hasPendingRegistrationDayWaitlist(result.dayWaitlist)) {
    icon = "🗓️";
    title = "Your registration is in place";
    body = (
      <>
        {/* The link is a sibling of the sentence rather than a block-level
            anchor inside it: the stack's gap is what separates them, and a
            paragraph is no longer asked to contain a block. */}
        <div class="pk-stack pk-stack--snug">
          <p class="event-flow-success-body">
            Your registration is confirmed, but one or more selected days are still waiting for a place.
          </p>
          <a href={manageHref}>Review or change registration</a>
        </div>
        <RegistrationDayStatusSummary dayAttendance={result.dayAttendance} dayWaitlist={result.dayWaitlist} />
        <PersonalAddressPrompt email={email} waiting />
      </>
    );
  } else {
    icon = "🎉";
    title = `You're registered${firstName ? `, ${firstName}` : ""}!`;
    body = (
      <>
        <p class="event-flow-success-body">
          A confirmation email with your calendar invite is on its way.{" "}
          <a href={manageHref}>Manage your registration</a>
        </p>
        <PersonalAddressPrompt email={email} />
      </>
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
      eventSlug,
      invitation: { status: result.status, startsAt: result.startsAt },
      waitlisted: hasPendingRegistrationDayWaitlist(result.dayWaitlist),
    });
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (donateRef.current) {
    renderDonationCta(donateRef.current, {
      name: fullName || undefined,
      email,
      source: window.location.pathname,
    });
  }

  root.appendChild(container);
  requestAnimationFrame(() => {
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
