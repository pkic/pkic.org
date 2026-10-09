import { agendaSessionPresentationTiming } from "./event-agenda-transition";
import { agendaOccurrenceMedia } from "./event-agenda-media";
import { publicSessionTiming } from "./session-public-timing";
import { statusLabel } from "./status-display";
import { sessionDisplayCredits, publicSessionCreditRole } from "./session-public-credits";
import { publicSessionMaterials, publicSessionMediaUrls } from "./schemas/event-session-history";
import { publishedSessionRoute } from "./session-public-route";
import { eventParticipationLink } from "./event-participation-link";
import { agendaDisplayRoles } from "./event-agenda-display-roles";
import { agendaOccurrenceRoomIds } from "./event-agenda-rooms";
import type { AgendaSnapshot, AgendaOccurrence } from "./schemas/event-agenda";
import type { ContentAgendaDay, ContentAgendaSpeaker } from "./site-agenda";
import { instantToDateTimeLocal } from "./timezone";
import { agendaSessionFormatContent } from "./event-agenda-format";
import { authoredAgendaDayFragments, authoredAgendaSpeakerFragments } from "./legacy-agenda-fragments";
import { agendaCreditOrganization } from "./agenda-speaker-organizations";
import type { ContentAgendaSpeakerFragment } from "./site-agenda";

type AgendaSpeakerCredit = Parameters<typeof publicSessionCreditRole>[1];
interface AgendaSpeakerPresentation {
  sourceKeys: Map<string, string>;
  personPaths: Map<string, string>;
}

function speakerPresentationKey(credit: AgendaSpeakerCredit, sourceKeys: Map<string, string>): string {
  if ("userId" in credit) return `user:${credit.userId}`;
  const sourceIdentity = JSON.stringify([credit.sourcePath, credit.sourceDigest, credit.sourceRef]);
  let key = sourceKeys.get(sourceIdentity);
  if (!key) {
    key = `source:${sourceKeys.size + 1}`;
    sourceKeys.set(sourceIdentity, key);
  }
  return key;
}

/** Source tuples identify credits internally; public keys reveal only an agenda-local ordinal. */
function agendaSpeakerPresentation(snapshot: AgendaSnapshot, organizer: boolean): AgendaSpeakerPresentation {
  const presentation: AgendaSpeakerPresentation = { sourceKeys: new Map(), personPaths: new Map() };
  const published = !organizer && snapshot.approvedAt && snapshot.publishedRevision === snapshot.revision;
  for (const occurrence of snapshot.occurrences) {
    if (!organizer && occurrence.visibility !== "public") continue;
    for (const credit of sessionDisplayCredits(occurrence, organizer)) {
      speakerPresentationKey(credit, presentation.sourceKeys);
      if (published && "userId" in credit && publishedSessionRoute(snapshot.eventSlug, occurrence)) {
        presentation.personPaths.set(credit.userId, `/people/${encodeURIComponent(credit.userId)}/`);
      }
    }
  }
  return presentation;
}

/** A supplied credit keeps the same frozen/source presentation on every public surface. */
export function agendaSpeakerContent(
  occurrence: AgendaOccurrence,
  credit: Parameters<typeof publicSessionCreditRole>[1],
  organizations?: AgendaSnapshot["speakerOrganizations"],
): ContentAgendaSpeaker {
  const organization =
    "biography" in credit
      ? agendaCreditOrganization(organizations, {
          actingIdentityId: "actingIdentityId" in credit ? credit.actingIdentityId : null,
          organizationName: credit.organizationName,
        })
      : undefined;
  return {
    name: credit.displayName,
    ...("biography" in credit
      ? {
          title: [credit.jobTitle, credit.organizationName].filter(Boolean).join(" at "),
          bioMarkdown: credit.biography,
          imageSrc: credit.photoUrl ?? undefined,
        }
      : {}),
    ...(organization ? { organization } : {}),
    moderator: publicSessionCreditRole(occurrence, credit) === "moderator",
    ...(publicSessionCreditRole(occurrence, credit) === "panelist" ? { roleLabel: statusLabel("panelist") } : {}),
  };
}

/**
 * A signed-in participant's projection: the server already scoped it to the
 * public programme plus only the private sessions this reader is invited to
 * or booked on, so every occurrence it carries is listed and actionable. A
 * private session still gets no public session page or speaker profile link.
 */
export interface AgendaContentOptions {
  participant?: boolean;
}

function listedOccurrence(organizer: boolean, options: AgendaContentOptions) {
  return (item: AgendaOccurrence) => organizer || Boolean(options.participant) || item.visibility === "public";
}

/** The canonical session card projection, including occurrences whose placement is not yet known. */
export function agendaSessionContent(
  snapshot: AgendaSnapshot,
  occurrence: AgendaOccurrence,
  organizer = false,
  speakerPresentation = agendaSpeakerPresentation(snapshot, organizer),
  options: AgendaContentOptions = {},
): ContentAgendaDay["slots"][number]["sessions"][number] {
  const listed = listedOccurrence(organizer, options);
  const timing = publicSessionTiming(occurrence);
  const credits = sessionDisplayCredits(occurrence, organizer).map((credit) => ({
    ...agendaSpeakerContent(occurrence, credit, snapshot.speakerOrganizations),
    speakerKey: speakerPresentationKey(credit, speakerPresentation.sourceKeys),
    personPath: "userId" in credit ? speakerPresentation.personPaths.get(credit.userId) : undefined,
  }));
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
  const presentation = materials.find((material) => material.kind === "presentation");
  const releasedUrls = publicSessionMediaUrls(materials);
  const media = agendaOccurrenceMedia(snapshot.rooms, occurrence);
  const presentationUrl =
    releasedUrls.presentationUrl || (organizer ? occurrence.presentationUrl : undefined) || undefined;
  return {
    id: occurrence.id,
    kind: occurrence.kind,
    sponsors: occurrence.kind === "break" ? occurrence.sponsors : undefined,
    publicAnchor: occurrence.publicAnchor ?? undefined,
    legacyFragments,
    participation:
      timing &&
      !timing.endNotRecorded &&
      occurrence.kind !== "break" &&
      (occurrence.visibility === "public" || options.participant)
        ? eventParticipationLink(snapshot.eventSlug, occurrence.id, occurrence.admissionPolicy, occurrence.accessPolicy)
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
    recordingApproved: Boolean(releasedUrls.recordingUrl),
    onlineAccessUrl:
      media.virtualRoomUrl || occurrence.onlineAccessAvailable
        ? eventParticipationLink(snapshot.eventSlug, occurrence.id, occurrence.admissionPolicy, occurrence.accessPolicy)
            .url
        : undefined,
    plannedMedia: { recording: media.recording, liveStreaming: media.liveStreaming },
    title: occurrence.title,
    track: occurrence.track ?? undefined,
    format: agendaSessionFormatContent(snapshot.formats, occurrence.format),
    placeholder: occurrence.placeholder || undefined,
    descriptionHtml: "",
    descriptionMarkdown: occurrence.description,
    endsAt: timing?.endAt,
    endNotRecorded: timing?.endNotRecorded,
    durationMinutes: timing?.endAt ? (Date.parse(timing.endAt) - Date.parse(timing.startAt)) / 60000 : undefined,
    ...agendaSessionPresentationTiming(occurrence, snapshot.occurrences.filter(listed), snapshot.timeZone),
    locations: agendaOccurrenceRoomIds(occurrence),
    speakers: credits,
  };
}

/** Translate API transport to the same presenter used by build-time public pages. */
export function agendaContent(
  snapshot: AgendaSnapshot,
  organizer = false,
  options: AgendaContentOptions = {},
): {
  days: ContentAgendaDay[];
  speakers: ContentAgendaSpeaker[];
  legacySpeakerFragments: ContentAgendaSpeakerFragment[];
} {
  const catalogue = new Map<string, ContentAgendaSpeaker>();
  const presentation = agendaSpeakerPresentation(snapshot, organizer);
  const occurrences = snapshot.occurrences.filter(listedOccurrence(organizer, options));
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
    const session = agendaSessionContent(snapshot, occurrence, organizer, presentation, options);
    for (const speaker of session.speakers) {
      if (speaker.speakerKey && !catalogue.has(speaker.speakerKey)) catalogue.set(speaker.speakerKey, speaker);
    }
    const legacyFragments = session.legacyFragments ?? [];
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
    slot.sessions.push(session);
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
