import { publicSessionTiming } from "./session-public-timing";
import { statusLabel } from "./status-display";
import { publicSessionCredits, publicSessionCreditRole } from "./session-public-credits";
import { publicSessionMaterials, publicSessionMediaUrls } from "./schemas/event-session-history";
import { publishedSessionRoute } from "./session-public-route";
import { eventParticipationLink } from "./event-participation-link";
import { agendaDisplayRoles } from "./event-agenda-display-roles";
import { agendaOccurrenceRoomIds } from "./event-agenda-rooms";
import type { AgendaSnapshot } from "./schemas/event-agenda";
import type { ContentAgendaDay, ContentAgendaSpeaker } from "./site-agenda";
import { instantToDateTimeLocal } from "./timezone";
import { authoredAgendaDayFragments, authoredAgendaSpeakerFragments } from "./legacy-agenda-fragments";
import type { ContentAgendaSpeakerFragment } from "./site-agenda";

/** Translate API transport to the same presenter used by build-time public pages. */
export function agendaContent(
  snapshot: AgendaSnapshot,
  organizer = false,
): {
  days: ContentAgendaDay[];
  speakers: ContentAgendaSpeaker[];
  legacySpeakerFragments: ContentAgendaSpeakerFragment[];
} {
  const catalogue = new Map<string, ContentAgendaSpeaker>();
  const occurrences = snapshot.occurrences.filter((item) => organizer || item.visibility === "public");
  const days = new Map<string, ContentAgendaDay>();
  for (const occurrence of occurrences) {
    const timing = publicSessionTiming(occurrence);
    if (!timing) continue;
    const wall = instantToDateTimeLocal(timing.startAt, snapshot.timeZone);
    const date = wall.slice(0, 10);
    let day = days.get(date);
    if (!day) {
      day = { date, locations: snapshot.rooms.map((room) => ({ id: room.id, label: room.name })), slots: [] };
      days.set(date, day);
    }
    let slot = day.slots.find((value) => value.startsAt === timing.startAt);
    if (!slot) {
      slot = { startsAt: timing.startAt, time: wall.slice(11), sessions: [] };
      day.slots.push(slot);
    }
    const credits = publicSessionCredits(occurrence).map((credit) => ({
      key: "userId" in credit ? `user:${credit.userId}` : `source:${credit.sourceRef}`,
      name: credit.displayName,
      ...("biography" in credit
        ? {
            title: [credit.jobTitle, credit.organizationName].filter(Boolean).join(" · "),
            bioMarkdown: credit.biography,
            imageSrc: credit.photoUrl ?? undefined,
          }
        : {}),
      moderator: publicSessionCreditRole(occurrence, credit) === "moderator",
      ...(publicSessionCreditRole(occurrence, credit) === "panelist" ? { roleLabel: statusLabel("panelist") } : {}),
    }));
    for (const credit of credits)
      if (!catalogue.has(credit.key)) {
        const { key, ...speaker } = credit;
        catalogue.set(key, speaker);
      }
    const materials = publicSessionMaterials(occurrence.history?.materials ?? []);
    const currentRoomIds = agendaOccurrenceRoomIds(occurrence);
    const legacyFragments = organizer
      ? []
      : (occurrence.history?.legacyFragments ?? []).map((fragment) => {
          // The authored receipt stays immutable; its alias follows this occurrence's current placement.
          const roomId =
            fragment.roomId && currentRoomIds.includes(fragment.roomId) ? fragment.roomId : occurrence.roomId;
          return { anchor: fragment.anchor, kind: fragment.kind, roomId };
        });
    if (legacyFragments.length) {
      const incoming = (occurrence.history?.legacyFragments ?? []).flatMap((fragment) =>
        authoredAgendaDayFragments(fragment.authoredDate),
      );
      day.legacyFragments = [
        ...new Map(
          [...(day.legacyFragments ?? []), ...incoming].map((fragment) => [fragment.anchor, fragment]),
        ).values(),
      ];
    }
    const presentation = materials.find((material) => material.kind === "presentation");
    const releasedUrls = publicSessionMediaUrls(materials);
    const presentationUrl =
      releasedUrls.presentationUrl || (organizer ? occurrence.presentationUrl : undefined) || undefined;
    slot.sessions.push({
      id: occurrence.id,
      publicAnchor: occurrence.publicAnchor ?? undefined,
      legacyFragments,
      participation:
        !timing.endNotRecorded && occurrence.kind !== "break" && occurrence.visibility === "public"
          ? eventParticipationLink(
              snapshot.eventSlug,
              occurrence.id,
              occurrence.admissionPolicy,
              occurrence.accessPolicy,
            )
          : undefined,
      presentationUrl,
      legacyPresentationUrl: organizer
        ? undefined
        : occurrence.history?.legacyDownloads.find(
            (download) =>
              presentation &&
              (presentation.presentationSource === "session" && presentation.presentationVersionId
                ? download.url === presentation.legacyDownloadUrl
                : !presentation.presentationVersionId && download.targetUrl === presentation.url),
          )?.url,
      sessionUrl: publishedSessionRoute(snapshot.eventSlug, occurrence),
      recordingUrl: releasedUrls.recordingUrl || (organizer ? occurrence.recordingUrl : undefined) || undefined,
      title: occurrence.title,
      track: occurrence.track ?? undefined,
      descriptionHtml: "",
      descriptionMarkdown: occurrence.description,
      endsAt: timing.endAt,
      endNotRecorded: timing.endNotRecorded,
      durationMinutes: timing.endAt ? (Date.parse(timing.endAt) - Date.parse(timing.startAt)) / 60000 : undefined,
      locations: agendaOccurrenceRoomIds(occurrence),
      speakers: credits.map(({ key: _key, ...speaker }) => speaker),
    });
  }
  for (const day of days.values()) {
    for (const occurrence of occurrences) {
      if (
        !occurrence.endAt ||
        !occurrence.startAt ||
        instantToDateTimeLocal(occurrence.startAt, snapshot.timeZone).slice(0, 10) !== day.date ||
        day.slots.some((slot) => slot.startsAt === occurrence.endAt)
      )
        continue;
      day.slots.push({
        startsAt: occurrence.endAt,
        time: instantToDateTimeLocal(occurrence.endAt, snapshot.timeZone).slice(11),
        sessions: [],
      });
    }
  }
  return {
    legacySpeakerFragments:
      !organizer && [...days.values()].some((day) => day.legacyFragments?.length) ? authoredAgendaSpeakerFragments : [],
    speakers: [...catalogue.values()],
    days: [...days.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({
        ...day,
        staffing: agendaDisplayRoles(snapshot, day.date, !organizer),
        slots: day.slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      })),
  };
}
