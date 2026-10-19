import type { AgendaOccurrence } from "./schemas/event-agenda";

/** Archived source timing never becomes a canonical occupancy or bookable interval. */
export function publicSessionTiming(session: AgendaOccurrence) {
  if (session.startAt && session.endAt)
    return { startAt: session.startAt, endAt: session.endAt, endNotRecorded: false };
  const archival = session.history?.archivalTiming;
  return !session.startAt && !session.endAt && archival
    ? { startAt: archival.startAt, endAt: undefined, endNotRecorded: true }
    : undefined;
}
