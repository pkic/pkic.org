/** Page host for the canonical public/portal registration form. */
import { EventRegistrationCreate } from "../../../../../components/events/EventRegistrationCreate";
import { Panel, PanelBody } from "../../../../../ui/Panel";
import { ButtonLink } from "../../../../../ui/Button";
import { usePortalHashLocation } from "../../../hash-location";
import { eventParticipantRecordPath } from "../event-participant-paths";
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
  if (standing.registered)
    return (
      <div class="pk-stack">
        <p>You're already registered for this event.</p>
        <ButtonLink
          href={usePortalHashLocation.hrefs(
            standing.registrationId
              ? eventParticipantRecordPath(event.slug, "registration", standing.registrationId)
              : `/events/${encodeURIComponent(event.slug)}/ticket`,
          )}
        >
          View registration
        </ButtonLink>
      </div>
    );
  const offer = registrationOffer(event, eventPhase(event.startsAt, event.endsAt).kind === "ended");
  if (offer.kind === "closed") return <p class="pk-muted">{offer.reason}</p>;
  return (
    <Panel aria-label="Event registration">
      <PanelBody>
        <EventRegistrationCreate
          slug={event.slug}
          onRegistered={async () => {
            await onRegistered?.();
            navigate(`/events/${encodeURIComponent(event.slug)}/ticket`);
          }}
        />
      </PanelBody>
    </Panel>
  );
}
