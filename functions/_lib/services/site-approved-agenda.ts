import { publicSessionTiming } from "../../../assets/shared/session-public-timing";
import { publicSessionCredits, publicSessionCreditRole } from "../../../assets/shared/session-public-credits";
import { agendaOccurrenceRoomIds } from "../../../assets/shared/event-agenda-rooms";
import type { AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import type { ConferenceProgram } from "../../../assets/shared/schemas/conference-program";
import { zonedDateTimeParts } from "../../../assets/shared/timezone";
import { publishedConferenceProgram } from "./site-conference-program";
import { publicSessionMediaUrls } from "../../../assets/shared/schemas/event-session-history";

/** Replace authored timing with the immutable approved snapshot during the build. */
export function applyApprovedAgenda(program: ConferenceProgram, snapshot?: AgendaSnapshot): ConferenceProgram {
  if (!snapshot) return program;
  const clock = (instant: string) => {
    const parts = zonedDateTimeParts(new Date(instant), snapshot.timeZone);
    return {
      date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
      time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
    };
  };
  const agenda: Record<
    string,
    Array<{
      time: string;
      sessions: Array<{
        id: string;
        publicAnchor?: string;
        title: string;
        description: string;
        speakers: string[];
        locations: string[];
        durationMinutes?: number;
        endNotRecorded?: boolean;
        presentation?: string;
        recordingUrl?: string;
      }>;
    }>
  > = {};
  const speakers = new Map(program.speakers.map((speaker) => [speaker.name, speaker]));
  for (const occurrence of snapshot.occurrences) {
    const timing = publicSessionTiming(occurrence);
    if (occurrence.visibility !== "public" || !timing) continue;
    const { date, time } = clock(timing.startAt);
    const slots = (agenda[date] ??= []);
    let slot = slots.find((candidate) => candidate.time === time);
    if (!slot) {
      slot = { time, sessions: [] };
      slots.push(slot);
    }
    const credits = publicSessionCredits(occurrence);
    for (const credit of credits)
      if (!speakers.has(credit.displayName) || "biography" in credit)
        speakers.set(credit.displayName, {
          ...("userId" in credit ? { id: credit.userId } : {}),
          name: credit.displayName,
          title: "jobTitle" in credit ? [credit.jobTitle, credit.organizationName].filter(Boolean).join(" · ") : null,
          bio: "biography" in credit ? credit.biography : null,
          headshot:
            "photoUrl" in credit && credit.photoUrl
              ? { x150: credit.photoUrl, x250: credit.photoUrl, x600: credit.photoUrl }
              : undefined,
          social: undefined,
          website: undefined,
        });
    const releasedUrls = publicSessionMediaUrls(occurrence.history?.materials ?? []);
    slot.sessions.push({
      id: occurrence.id,
      publicAnchor: occurrence.publicAnchor ?? undefined,
      title: occurrence.title,
      presentation: releasedUrls.presentationUrl ?? undefined,
      recordingUrl: releasedUrls.recordingUrl ?? undefined,
      description: occurrence.description,
      speakers: credits.map((credit) =>
        publicSessionCreditRole(occurrence, credit) === "moderator" ? `${credit.displayName} *` : credit.displayName,
      ),
      locations: agendaOccurrenceRoomIds(occurrence),
      durationMinutes: timing.endAt ? (Date.parse(timing.endAt) - Date.parse(timing.startAt)) / 60_000 : undefined,
      endNotRecorded: timing.endNotRecorded,
    });
  }
  for (const slots of Object.values(agenda)) slots.sort((a, b) => a.time.localeCompare(b.time));
  const authoredRooms = Object.values(program.locations).filter(
    (value): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value),
  );
  const locations = {
    order: snapshot.rooms.map((room) => room.id),
    ...Object.fromEntries(
      snapshot.rooms.map((room) => [
        room.id,
        { ...authoredRooms.find((source) => source.name === room.name), name: room.name },
      ]),
    ),
  };
  const approved = publishedConferenceProgram(
    { ...program, draft: false, timezone: snapshot.timeZone, agenda, speakers: [...speakers.values()], locations },
    () => [],
  );
  // Preserve already exported speaker media rather than re-resolving runtime URLs.
  return { ...approved, speakers: [...speakers.values()] };
}
