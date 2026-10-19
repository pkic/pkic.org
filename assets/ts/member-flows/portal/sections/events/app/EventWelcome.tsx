import { DonationPrompt } from "../../../../../shared/donation/DonationPrompt";
/**
 * The personal top of the event home: a greeting for the reader's own clock
 * with where the event stands, the question in-person attendees most need to
 * answer ("will we see you?"), and a standing invitation to support the work.
 *
 * In-person seats are limited and there is a waiting list, so the attendance
 * check is asked plainly and early, and "no" leads straight to that day's
 * choices on the registration page rather than to a form to search through.
 */
import { useEffect, useState } from "preact/hooks";

import { ButtonLink } from "../../../../../ui/Button";
import { Button } from "../../../../../ui/Button";
import { usePortalHashLocation } from "../../../hash-location";
import { profile } from "../../../state";
import { eventParticipantRecordPath } from "../event-participant-paths";
import { EventCard } from "./EventCard";
import { eventRegistrationStanding, type ParticipantEventDetail } from "./event-app-model";
import { calendarDate, countdownLabel, eventCountdown, greetingFor } from "./event-welcome";
import { attendanceStanding, attendanceStandingLine } from "../../../../../shared/viewer-attendance";

const href = usePortalHashLocation.hrefs;
const MINUTE = 60_000;

/** The current time, refreshed each minute so the countdown moves on its own. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE / 2);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function WelcomeBanner({ event }: { event: ParticipantEventDetail }) {
  const now = useMinuteClock();
  const name = profile.value?.preferredName || profile.value?.firstName || "";
  const greeting = greetingFor(new Date(now).getHours());
  const countdown = eventCountdown(now, event.startsAt, event.endsAt, event.timezone);
  const status = countdownLabel(countdown);
  const viewer = "viewer" in event ? event.viewer : null;
  const standing = viewer && viewer.registrationStatus === "registered" ? attendanceStandingLine(viewer) : "";
  return (
    <section class="pk-event-welcome" aria-label="Welcome" data-phase={countdown.kind}>
      <p class="pk-event-welcome__greeting">{name ? `${greeting}, ${name}` : greeting}</p>
      {status && <p class="pk-event-welcome__status">{status}</p>}
      {standing && <p class="pk-event-welcome__standing">{standing}</p>}
    </section>
  );
}

function readConfirmed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "yes";
  } catch {
    return false;
  }
}

function writeConfirmed(key: string): void {
  try {
    localStorage.setItem(key, "yes");
  } catch {
    // A private window keeps no memory; the question simply returns next visit.
  }
}

/**
 * "Will we see you tomorrow?" for the next in-person day within a day; for
 * days further out, a standing "plans changed?" with the same destination.
 */
export function AttendanceCheckCard({ event }: { event: ParticipantEventDetail }) {
  const now = useMinuteClock();
  const standing = eventRegistrationStanding(event);
  const viewer = "viewer" in event ? event.viewer : null;
  const zone = event.timezone ?? "UTC";
  const today = calendarDate(now, zone);
  const tomorrow = calendarDate(now + 24 * 60 * MINUTE, zone);
  // Only a confirmed in-person day has a seat to release; a waitlisted or online day does not.
  const nextDay = viewer
    ? attendanceStanding(viewer)
        .inPerson.filter((date) => date >= today)
        .sort()[0]
    : undefined;
  const key = `pk-attendance-confirmed:${event.slug}:${nextDay ?? ""}`;
  const [confirmed, setConfirmed] = useState(() => readConfirmed(key));

  if (!standing.registered || standing.status !== "registered" || !standing.registrationId) return null;
  if (!nextDay) return null;
  const registration = eventParticipantRecordPath(event.slug, "registration", standing.registrationId);
  const soon = nextDay === today || nextDay === tomorrow;

  if (soon && confirmed)
    return (
      <EventCard eyebrow="See you there" title="Your seat is waiting">
        <p>Thank you for confirming. If anything changes, you can still release your seat.</p>
        <div class="pk-cluster">
          <a href={href(`${registration}?day=${nextDay}`)}>I can't make it after all</a>
        </div>
      </EventCard>
    );

  if (soon)
    return (
      <EventCard eyebrow="Quick question" title={`Will we see you ${nextDay === today ? "today" : "tomorrow"}?`}>
        <p>In-person seats are limited. If you can't come, your seat goes to someone on the waiting list.</p>
        <div class="pk-cluster">
          <Button
            variant="primary"
            onClick={() => {
              writeConfirmed(key);
              setConfirmed(true);
            }}
          >
            Yes, I'll be there
          </Button>
          <ButtonLink href={href(`${registration}?day=${nextDay}`)}>No, I can't make it</ButtonLink>
        </div>
      </EventCard>
    );

  return (
    <EventCard eyebrow="Plans changed?" title="Can't attend in person?">
      <p>Release your seat so someone on the waiting list can take it. You can still join online.</p>
      <div class="pk-cluster">
        <ButtonLink href={href(registration)}>Update my days</ButtonLink>
      </div>
    </EventCard>
  );
}

export function SupportCard({ source }: { source?: string }) {
  const donor = profile.value;
  return (
    <DonationPrompt
      options={{
        name: donor ? [donor.firstName, donor.lastName].filter(Boolean).join(" ") : null,
        email: donor?.email,
        organizationName: donor?.organizationName,
        source,
      }}
    />
  );
}
