import { eventPlaceSummary } from "../../../../../../shared/event-place";
import { JoinPrompt } from "../../JoinPrompt";
/**
 * The event app's home: the event's key visual, then one card per thing an
 * attendee comes here to do — find their next session, see what is running
 * now, show their ticket or register, and follow their proposals.
 *
 * Everything reads data the portal already has: the caller-scoped event
 * projection the page loaded, and the personal agenda API My agenda lists.
 */
import { Badge } from "../../../../../components/Badge";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../components/Spinner";
import { ButtonLink } from "../../../../../ui/Button";
import { agendaTimeZones } from "../../../../../../shared/agenda-time-display";
import { contractClock, eventClock } from "../../../../../../shared/event-clock";
import {
  formatDateTimeInZone,
  formatTimeRangeInZone,
  formatWeekdayTimeInZone,
} from "../../../../../../shared/format-date";
import { viewerTimeZone } from "../../../../../../shared/timezone";
import { formatNumber } from "../../../../../../shared/format-number";
import { usePortalHashLocation } from "../../../hash-location";
import { formatDateRange } from "../../../ui";
import { eventParticipantRecordPath } from "../event-participant-paths";
import { EventCard } from "./EventCard";
import { EventHero } from "./EventHero";
import { eventPhase, sessionPhase } from "./event-timing";
import { attendanceStanding, attendanceStandingParts } from "../../../../../shared/viewer-attendance";
import {
  eventManagementPath,
  eventRegistrationStanding,
  registrationOffer,
  type ParticipantEventDetail,
} from "./event-app-model";
import { hasEventProposals } from "./event-app-tabs";
import { eventAgendaRoute, eventSessionRoute } from "../../../../../../shared/event-participation-link";
import { RegistrationOfferNotice } from "./RegistrationOfferNotice";
import { useEventNow, type AgendaSession } from "./useEventNow";
import { AttendanceCheckCard, SupportCard, WelcomeBanner } from "./EventWelcome";
import { WatchLiveCard } from "./virtual-room/WatchLiveCard";
import { PersonalAddressPrompt } from "../../../../../components/events/PersonalAddressPrompt";
import { CheckInCard } from "./CheckInCard";

const href = usePortalHashLocation.hrefs;

const SESSION_STATUS_LABELS = {
  saved: "Saved",
  reserved: "Reserved",
  approval_pending: "Awaiting approval",
  waitlisted: "Waitlisted",
} as const;

/** The event hero the event home opens with. */
export function EventAppHero({ event }: { event: ParticipantEventDetail }) {
  const phase = eventPhase(event.startsAt, event.endsAt);
  const place = eventPlaceSummary(event);
  // An organizer opening the attendee app still needs the way to the workspace where the event is run.
  const managementPath = eventManagementPath(event);
  const eventPage = event.basePath ? (
    <ButtonLink href={event.basePath} external>
      Event page
    </ButtonLink>
  ) : null;
  return (
    <EventHero
      back={{ href: href("/events"), label: "Events" }}
      title={event.name}
      eyebrow={event.startsAt ? formatDateRange(event.startsAt, event.endsAt, event.timezone) : undefined}
      status={phase.label ? { label: phase.label, live: phase.kind === "live" } : null}
      meta={place ? [place] : []}
      actions={
        eventPage || managementPath ? (
          <>
            {eventPage}
            {managementPath && <ButtonLink href={href(managementPath)}>Manage event</ButtonLink>}
          </>
        ) : undefined
      }
    />
  );
}

function sessionWhen(session: AgendaSession): string {
  if (!session.startAt) return "Time to be announced";
  const zone = agendaTimeZones(contractClock(session), viewerTimeZone(), session.attendanceMode).primary.zone;
  const { weekday } = formatWeekdayTimeInZone(session.startAt, zone);
  return `${weekday} · ${formatTimeRangeInZone(session.startAt, session.endAt ?? undefined, zone)}`;
}

function sessionRooms(session: AgendaSession): string | null {
  return session.rooms.length ? session.rooms.map((room) => room.name).join(", ") : null;
}

function sessionHref(slug: string, session: AgendaSession): string {
  return href(eventSessionRoute(slug, session.id));
}

function NextSessionCard({ slug, session }: { slug: string; session: AgendaSession | null }) {
  if (!session)
    return (
      <EventCard eyebrow="Your next session" title="Nothing on your agenda yet">
        <p>Star sessions on the agenda and your next one appears here.</p>
        <div class="pk-cluster">
          <ButtonLink href={href(eventAgendaRoute(slug))}>Browse the agenda</ButtonLink>
        </div>
      </EventCard>
    );
  const phase = sessionPhase(session.startAt, session.endAt);
  const rooms = sessionRooms(session);
  return (
    <EventCard
      eyebrow={
        phase === "live"
          ? "Your session · Live now"
          : phase === "soon"
            ? "Your next session · Soon"
            : "Your next session"
      }
      title={<a href={sessionHref(slug, session)}>{session.title}</a>}
      live={phase === "live"}
    >
      <p class="pk-event-card__meta">{sessionWhen(session)}</p>
      {rooms && <p class="pk-event-card__meta">{rooms}</p>}
      {/* A released seat on a starred session is only a star. */}
      {session.status && session.status !== "canceled" && (
        <div class="pk-cluster">
          <Badge status={session.status} label={SESSION_STATUS_LABELS[session.status]} />
        </div>
      )}
    </EventCard>
  );
}

function LiveNowCard({ slug, sessions }: { slug: string; sessions: readonly AgendaSession[] }) {
  if (!sessions.length) return null;
  return (
    <EventCard eyebrow="Live now" title={`${formatNumber(sessions.length)} running now`} live>
      <ul class="pk-plain-list pk-stack pk-stack--tight" aria-label="Sessions running now">
        {sessions.map((session) => (
          <li key={session.id} class="pk-stack pk-stack--tight">
            <a href={sessionHref(slug, session)} class="pk-strong">
              {session.title}
            </a>
            <span class="pk-event-card__meta">
              {[sessionRooms(session), sessionWhen(session)].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </EventCard>
  );
}

function TicketCard({ event, ended }: { event: ParticipantEventDetail; ended: boolean }) {
  const standing = eventRegistrationStanding(event);
  const base = `/events/${encodeURIComponent(event.slug)}`;
  if (!standing.registered) {
    // The hero already says an event has ended; there is nothing left to register for.
    if (ended) return null;
    const offer = registrationOffer(event, ended);
    return (
      <EventCard
        eyebrow="Registration"
        title={offer.kind === "closed" ? "Not registered" : "You're not registered yet"}
      >
        <RegistrationOfferNotice offer={offer} slug={event.slug} />
      </EventCard>
    );
  }
  const viewer = "viewer" in event ? event.viewer : null;
  const pending = standing.status === "pending_email_confirmation";
  return (
    <EventCard eyebrow="Your ticket" title={pending ? "Confirm your email address" : "You're registered"}>
      {pending && <p>Check your inbox to complete your registration.</p>}
      {viewer && <p class="pk-event-card__meta">{attendanceStandingParts(viewer).join(" · ")}</p>}
      {viewer && <PersonalAddressPrompt withoutWorkAddress={!viewer.holdsWorkAddress} />}
      <div class="pk-cluster">
        <ButtonLink variant="primary" href={href(base + "/ticket")}>
          Show ticket
        </ButtonLink>
        {standing.registrationId && (
          <a href={href(eventParticipantRecordPath(event.slug, "registration", standing.registrationId))}>
            Manage registration
          </a>
        )}
      </div>
    </EventCard>
  );
}

/** The event's open call for proposals, as the public form to submit through; null when closed. */
function openProposalCall(event: ParticipantEventDetail): string | null {
  return event.proposalCall?.open ? event.proposalCall.path : null;
}

function ProposalsCard({ event }: { event: ParticipantEventDetail }) {
  const call = openProposalCall(event);
  const closesAt = event.proposalCall?.closesAt;
  if (!hasEventProposals(event))
    return call ? (
      <EventCard eyebrow="Call for proposals" title="Speak at this event">
        {closesAt && <p class="pk-event-card__meta">Closes {formatDateTimeInZone(closesAt, eventClock(event))}</p>}
        <div class="pk-cluster">
          <ButtonLink variant="primary" href={call}>
            Submit a proposal
          </ButtonLink>
        </div>
      </EventCard>
    ) : null;
  const submitted = event.participation?.proposals ?? 0;
  const speaking = event.participation?.speakerProposals ?? 0;
  return (
    <EventCard eyebrow="Your proposals" title="Proposals and speaking">
      <p>
        {[
          submitted ? `${formatNumber(submitted)} submitted` : null,
          speaking ? `${formatNumber(speaking)} as speaker` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div class="pk-cluster">
        {call && <ButtonLink href={call}>Submit a proposal</ButtonLink>}
        <a href={href(`/events/${encodeURIComponent(event.slug)}/submissions`)}>View proposals</a>
      </div>
    </EventCard>
  );
}

export function EventHome({ event }: { event: ParticipantEventDetail }) {
  const phase = eventPhase(event.startsAt, event.endsAt);
  const ended = phase.kind === "ended";
  const current =
    (phase.kind === "live" || phase.kind === "upcoming") && eventRegistrationStanding(event).status === "registered";
  const now = useEventNow(event.slug, current);
  // Online attendees are sent to the stream first; everyone else still reaches it from a session's Join online.
  const viewer = "viewer" in event ? event.viewer : null;
  const standing = viewer ? attendanceStanding(viewer) : null;
  const watchesOnline = Boolean(standing?.online && !standing.holdsInPersonSeat);
  return (
    <div class="pk-event-home pk-grid pk-grid--cards">
      <WelcomeBanner event={event} />
      {phase.kind === "live" &&
        eventRegistrationStanding(event).registered &&
        standing?.holdsInPersonSeat !== false && <CheckInCard slug={event.slug} />}
      {current && watchesOnline && now.data && <WatchLiveCard slug={event.slug} live={now.data.live} />}
      {!ended && <AttendanceCheckCard event={event} />}
      {current &&
        (now.loading ? (
          <Spinner label="Loading your agenda…" />
        ) : now.error ? (
          <ErrorAlert error={now.error} />
        ) : (
          <>
            <NextSessionCard slug={event.slug} session={now.data?.next ?? null} />
            <LiveNowCard slug={event.slug} sessions={now.data?.live ?? []} />
          </>
        ))}
      <TicketCard event={event} ended={ended} />
      <ProposalsCard event={event} />
      <SupportCard source={`event:${event.slug}`} />
      <JoinPrompt />
    </div>
  );
}
