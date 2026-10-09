import type { ContentAgendaDay, ContentAgendaLocation, ContentAgendaSpeaker } from "../../shared/site-agenda";

export interface AgendaSpeakerSession {
  id: string;
  title: string;
  startsAt: string;
  room: string;
  url?: string;
  moderator: boolean;
}

/** Associate only the already supplied stable credit reference; each occurrence keeps its own frozen display. */
export function agendaSpeakerSessions(
  days: readonly ContentAgendaDay[],
): ReadonlyMap<string, readonly AgendaSpeakerSession[]> {
  const result = new Map<string, AgendaSpeakerSession[]>();
  for (const day of days)
    for (const slot of day.slots)
      for (const session of slot.sessions) {
        if (!session.id) continue;
        for (const speaker of session.speakers) {
          if (!speaker.speakerKey) continue;
          const entries = result.get(speaker.speakerKey) ?? [];
          const entry = agendaSpeakerSession(session, slot.startsAt, day.locations, speaker);
          if (entry && !entries.some((existing) => existing.id === entry.id)) entries.push(entry);
          result.set(speaker.speakerKey, entries);
        }
      }
  return result;
}

/** A credit without a stable reference may show its own occurrence, never a name-based association. */
export function agendaSpeakerSession(
  session: ContentAgendaDay["slots"][number]["sessions"][number],
  startsAt: string,
  rooms: readonly ContentAgendaLocation[],
  speaker: ContentAgendaSpeaker,
): AgendaSpeakerSession | undefined {
  if (!session.id) return undefined;
  return {
    id: session.id,
    title: session.title,
    startsAt,
    room: session.locations
      .map((id) => rooms.find((room) => room.id === id)?.label)
      .filter(Boolean)
      .join(" / "),
    url: session.sessionUrl ?? (session.publicAnchor ? `#${session.publicAnchor}` : undefined),
    moderator: Boolean(speaker.moderator),
  };
}
