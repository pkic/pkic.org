/** Page host for the canonical public/portal registration form. */
import { EventRegistrationCreate } from "../../../../../components/events/EventRegistrationCreate";
import { EventTicketPricing } from "../../../../../components/events/tickets/EventTicketPricing";
import { TicketStandingNotice } from "../../../../../components/events/tickets/TicketStandingNotice";
import { continueToTicketPayment } from "../../../../../components/events/tickets/ticket-payment";
import { Panel, PanelBody } from "../../../../../ui/Panel";
import { ButtonLink } from "../../../../../ui/Button";
import { usePortalHashLocation } from "../../../hash-location";
import { ticketStanding } from "../../../../../../shared/event-ticket-standing";
import { eventParticipantRecordPath } from "../../../../../../shared/event-participant-paths";
import { eventRegistrationStanding, registrationOffer, type ParticipantEventDetail } from "./event-app-model";
import { eventPhase } from "./event-timing";

export function EventRegister({
  event,
  onRegistered,
}: {
  event: ParticipantEventDetail;
  onRegistered?: () => Promise<void>;
}) {
  const [, navigate] = usePortalHashLocation();
  const standing = eventRegistrationStanding(event);
  if (standing.registered) {
    // A ticket still to pay leaves the registration incomplete, so the page says that instead of "registered".
    const viewer = "viewer" in event ? event.viewer : null;
    const registration = usePortalHashLocation.hrefs(
      standing.registrationId
        ? eventParticipantRecordPath(event.slug, "registration", standing.registrationId)
        : `/events/${encodeURIComponent(event.slug)}/ticket`,
    );
    if (ticketStanding(viewer ?? {}) !== "settled")
      return (
        <div class="pk-stack">
          <TicketStandingNotice
            eventSlug={event.slug}
            paymentDue={Boolean(viewer?.paymentDue)}
            paymentProcessing={Boolean(viewer?.paymentProcessing)}
          />
          <a href={registration}>View registration</a>
        </div>
      );
    return (
      <div class="pk-stack">
        <p>You're already registered for this event.</p>
        <ButtonLink href={registration}>View registration</ButtonLink>
      </div>
    );
  }
  const offer = registrationOffer(event, eventPhase(event.startsAt, event.endsAt).kind === "ended");
  if (offer.kind === "closed") return <p class="pk-muted">{offer.reason}</p>;
  return (
    <Panel aria-label="Event registration">
      <PanelBody>
        <EventTicketPricing slug={event.slug}>
          <EventRegistrationCreate
            slug={event.slug}
            onRegistered={async (result) => {
              if (await continueToTicketPayment(event.slug, result.registrationId)) return;
              await onRegistered?.();
              navigate(`/events/${encodeURIComponent(event.slug)}/ticket`);
            }}
          />
        </EventTicketPricing>
      </PanelBody>
    </Panel>
  );
}
