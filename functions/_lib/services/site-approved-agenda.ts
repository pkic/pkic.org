import type { AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import type { ConferenceProgram } from "../../../assets/shared/schemas/conference-program";
import { zonedDateTimeParts } from "../../../assets/shared/timezone";
import { publishedConferenceProgram } from "./site-conference-program";

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
        title: string;
        description: string;
        speakers: string[];
        locations: string[];
        durationMinutes: number;
        presentation?: string;
        recordingUrl?: string;
      }>;
    }>
  > = {};
  const speakers = new Map(program.speakers.map((speaker) => [speaker.name, speaker]));
  for (const occurrence of snapshot.occurrences) {
    if (occurrence.visibility !== "public" || !occurrence.startAt || !occurrence.endAt) continue;
    const { date, time } = clock(occurrence.startAt);
    const slots = (agenda[date] ??= []);
    let slot = slots.find((candidate) => candidate.time === time);
    if (!slot) {
      slot = { time, sessions: [] };
      slots.push(slot);
    }
    for (const speaker of occurrence.speakers)
      if (!speakers.has(speaker.displayName))
        speakers.set(speaker.displayName, {
          id: speaker.userId,
          name: speaker.displayName,
          title: null,
          bio: null,
          social: undefined,
          website: undefined,
        });
    slot.sessions.push({
      id: occurrence.id,
      title: occurrence.title,
      presentation: occurrence.presentationUrl ?? undefined,
      recordingUrl: occurrence.recordingUrl ?? undefined,
      description: occurrence.description,
      speakers: occurrence.speakers.map((speaker) => speaker.displayName),
      locations: occurrence.roomId ? [occurrence.roomId] : [],
      durationMinutes: (Date.parse(occurrence.endAt) - Date.parse(occurrence.startAt)) / 60_000,
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
