import { publicSessionTiming } from "../../../../assets/shared/session-public-timing";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import {
  publicSessionMaterials,
  publicSessionMediaUrls,
} from "../../../../assets/shared/schemas/event-session-history";
import { retainedSpeakerOrganizations } from "../../../../assets/shared/agenda-speaker-affiliations";
import { agendaOccurrenceMedia } from "../../../../assets/shared/event-agenda-media";
import { eventPublishesPages } from "../../../../assets/shared/public-agenda-pages";
import { eventClockCity } from "../../../../assets/shared/event-clock";
import type { EventVisibility } from "../../../../assets/shared/schemas/event-series";
import type { EventPlace } from "../../../../assets/shared/event-place";

/**
 * Exact document projection shared by authenticated previews and static publication extraction.
 * A participant's own projection may also admit the named private sessions they are invited to
 * or booked on; those are sanitized exactly like public ones and never published.
 */
export function publicAgendaProjection(
  approved: AgendaSnapshot,
  event: { basePath: string | null; visibility: EventVisibility | string } & EventPlace,
  privateOccurrenceIds: ReadonlySet<string> = new Set(),
): AgendaSnapshot {
  const basePath = event.basePath;
  const occurrences = approved.occurrences.filter(
    (item) =>
      (item.visibility === "public" || privateOccurrenceIds.has(item.id)) && publicSessionTiming(item) !== undefined,
  );
  return {
    ...approved,
    publicAgendaPath:
      (basePath?.startsWith("/") && !basePath.startsWith("//")
        ? basePath.replace(/\/$/u, "")
        : `/events/${approved.eventSlug}`) + "/agenda/",
    // Live, never frozen: whether the site publishes this agenda's pages follows the event as it is now.
    publicPages: eventPublishesPages(event.visibility),
    // Live like the pages: the clock is named by the city the event is in now.
    clockCity: eventClockCity(event.city),
    eventPlace: { city: eventClockCity(event.city), country: event.country },
    // Draft proposal selections are removed below, so only approved appearances keep an organization.
    speakerOrganizations: retainedSpeakerOrganizations(approved.speakerOrganizations, occurrences),
    // A location's virtual-room link is as private as a session's own; sessions expose only its availability.
    rooms: approved.rooms.map(({ virtualRoomUrl: _link, ...room }) => room),
    occurrences: occurrences.map((item) => ({
      ...item,
      virtualRoomUrl: undefined,
      sponsorIds: undefined,
      sponsors: item.kind === "break" ? item.sponsors : undefined,
      onlineAccessAvailable: Boolean(agendaOccurrenceMedia(approved.rooms, item).virtualRoomUrl),
      ...publicSessionMediaUrls(item.history?.materials ?? []),
      speakers: item.speakers.map((speaker) => ({
        userId: speaker.userId,
        displayName: speaker.displayName,
        role: speaker.role,
      })),
      promotionCopy: item.promotionCopy?.approvedAt ? item.promotionCopy : undefined,
      history: item.history
        ? {
            ...item.history,
            sourceDecisions: [],
            proposalRepresentations: [],
            materials: publicSessionMaterials(item.history.materials),
          }
        : undefined,
    })),
    staffingReport: undefined,
    shifts: [],
    assignments: [],
    roleMembers: [],
  };
}
