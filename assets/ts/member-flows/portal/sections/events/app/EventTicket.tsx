/**
 * The attendee's ticket is their badge: the organizers' print renderer draws
 * the same front — template, sponsor artwork, role band, the QR code and the
 * readable code under it — at the printed badge's proportions.
 *
 * `PUT /api/v1/events/:slug/badges/current` returns the holder's own active
 * badge (issuing one for a confirmed registration that has none), so the code
 * on the phone is the code on the printed badge and the scanner admits both.
 */
import type { ComponentChildren } from "preact";
import { currentBadgeResponseSchema } from "../../../../../../shared/schemas/route-contracts-event-current-badge";
import { BadgeFace } from "../../../../../components/event-badges/BadgeFace";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../components/Spinner";
import { useData } from "../../../../../hooks/useData";
import { putJson } from "../../../../../shared/api-client";
import { EmptyState } from "../../../../../ui/EmptyState";
import { usePortalHashLocation } from "../../../hash-location";
import { eventParticipantRecordPath } from "../event-participant-paths";
import { EventCard } from "./EventCard";
import { eventRegistrationStanding, registrationOffer, type ParticipantEventDetail } from "./event-app-model";
import { eventPhase } from "./event-timing";
import { RegistrationOfferNotice } from "./RegistrationOfferNotice";

export function EventTicket({ event }: { event: ParticipantEventDetail }) {
  const standing = eventRegistrationStanding(event);
  const ended = eventPhase(event.startsAt, event.endsAt).kind === "ended";
  if (!standing.registered)
    return (
      <EventCard eyebrow="Your ticket" title="No ticket yet">
        <RegistrationOfferNotice offer={registrationOffer(event, ended)} />
      </EventCard>
    );
  if (!standing.registrationId)
    return (
      <EmptyState
        title="Your registration is recorded"
        body="Your ticket details appear here once your registration record is available to you."
      />
    );
  const details = (
    <a
      href={usePortalHashLocation.hrefs(
        eventParticipantRecordPath(event.slug, "registration", standing.registrationId),
      )}
    >
      Registration details
    </a>
  );
  if (standing.status !== "registered")
    return (
      <EventCard eyebrow="Your ticket" title="Confirm your registration">
        <p>
          Confirm your email address first: your badge and its check-in code appear once your registration is confirmed.
        </p>
        <div class="pk-cluster">{details}</div>
      </EventCard>
    );
  return <BadgeTicket event={event} details={details} />;
}

function BadgeTicket({ event, details }: { event: ParticipantEventDetail; details: ComponentChildren }) {
  const ticket = useData(async () => {
    const current = await putJson(
      `/api/v1/events/${encodeURIComponent(event.slug)}/badges/current`,
      {},
      currentBadgeResponseSchema,
    );
    // A label withheld by contact retention prints blank, as it does on paper.
    return { ...current, badge: { ...current.badge, displayName: current.badge.displayName ?? "" } };
  }, [event.slug]);
  return (
    <div class="pk-stack">
      {ticket.loading ? (
        <Spinner label="Loading your badge…" />
      ) : ticket.data ? (
        <BadgeFace badge={ticket.data.badge} printing={ticket.data.printing} title={`Your badge for ${event.name}`} />
      ) : (
        <ErrorAlert error={ticket.error ?? "Your badge is unavailable."} />
      )}
      <EventCard eyebrow="At the venue">
        <p>
          Show this QR code at the entrance and at sessions, or read out the code printed under it. Your printed badge
          at the registration desk carries the same code.
        </p>
        <div class="pk-cluster">{details}</div>
      </EventCard>
    </div>
  );
}
