/**
 * The event home's check-in state on an event day: whether the attendee is
 * checked in at the venue, since when, and the way to scan a code.
 */
import { contractClock } from "../../../../../../shared/event-clock";
import { formatClockInZone } from "../../../../../../shared/format-date";
import { currentAttendanceResponseSchema } from "../../../../../../shared/schemas/event-attendance-points";
import { useData } from "../../../../../hooks/useData";
import { getJson } from "../../../../../shared/api-client";
import { ButtonLink } from "../../../../../ui/Button";
import { usePortalHashLocation } from "../../../hash-location";
import { EventCard } from "./EventCard";
import { eventCheckInPath } from "../event-participant-paths";

export function CheckInCard({ slug }: { slug: string }) {
  const current = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/attendance/check-ins/current`,
        currentAttendanceResponseSchema,
      ),
    [slug],
  );
  const state = current.data;
  // Outside the event's days, or while it loads or fails, the home simply has no check-in card.
  if (!state?.dayDate) return null;
  const clock = contractClock(state);
  const at = state.changedAt ? formatClockInZone(state.changedAt, clock) : null;
  const scan = (
    <div class="pk-cluster">
      <ButtonLink
        variant={state.venue === "none" ? "primary" : undefined}
        href={usePortalHashLocation.hrefs(eventCheckInPath(slug))}
      >
        Scan a code
      </ButtonLink>
    </div>
  );
  return (
    <EventCard
      eyebrow={`Check-in · ${state.dayLabel}`}
      title={
        state.venue === "checked_in"
          ? "You're checked in"
          : state.venue === "checked_out"
            ? "You're checked out"
            : "Check in when you arrive"
      }
    >
      {state.venue === "none" ? (
        <p>Scan the check-in code at the entrance with this app or your phone's camera.</p>
      ) : (
        at && <p class="pk-event-card__meta">{state.venue === "checked_in" ? `Since ${at}` : `At ${at}`}</p>
      )}
      {state.lastSession && <p class="pk-event-card__meta">Last session: {state.lastSession.title}</p>}
      {scan}
    </EventCard>
  );
}
