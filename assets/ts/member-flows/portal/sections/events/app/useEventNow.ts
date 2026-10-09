/**
 * The event home's "now": the reader's next session and the sessions running
 * at this moment, from the same personal agenda API My agenda lists.
 *
 * Two bounded reads, both filtered and ordered by the server: the first few
 * sessions still running or ahead (`from=now`), whose earliest are the ones
 * running now, and the reader's own first such session (`mine`).
 */
import type { z } from "zod";
import {
  personalAgendaResponseSchema,
  type personalAgendaSessionSchema,
} from "../../../../../../shared/schemas/event-personal-agenda";
import { useData } from "../../../../../hooks/useData";
import { getJson } from "../../../../../shared/api-client";
import { sessionPhase } from "./event-timing";

export type AgendaSession = z.infer<typeof personalAgendaSessionSchema>;

const LIVE_SHOWN = 5;

/** On the reader's agenda: saved, held, or awaiting a place — not cancelled. */
export function onMyAgenda(session: AgendaSession): boolean {
  return session.saved || (session.status !== null && session.status !== "canceled");
}

export interface EventNow {
  next: AgendaSession | null;
  live: AgendaSession[];
}

export function pickEventNow(sessions: readonly AgendaSession[], now = Date.now()): EventNow {
  let next: AgendaSession | null = null;
  const live: AgendaSession[] = [];
  for (const session of sessions) {
    const phase = sessionPhase(session.startAt, session.endAt, now);
    if (phase === "live" && live.length < LIVE_SHOWN) live.push(session);
    if (!next && onMyAgenda(session) && (phase === "live" || phase === "soon" || phase === "later")) next = session;
  }
  return { next, live };
}

function agendaWindow(slug: string, query: Record<string, string>) {
  const params = new URLSearchParams({ sort: "startAt", ...query });
  return getJson(
    `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation?${params}`,
    personalAgendaResponseSchema,
  );
}

async function loadEventNow(slug: string): Promise<EventNow> {
  const now = Date.now();
  const from = new Date(now).toISOString();
  const [ahead, mine] = await Promise.all([
    agendaWindow(slug, { from, limit: String(LIVE_SHOWN) }),
    agendaWindow(slug, { from, mine: "true", limit: "1" }),
  ]);
  return { next: pickEventNow(mine.sessions, now).next, live: pickEventNow(ahead.sessions, now).live };
}

/** Loads only while the event is on or ahead; an ended or unscheduled event has no "now". */
export function useEventNow(slug: string, enabled: boolean) {
  return useData(
    () => (enabled ? loadEventNow(slug) : Promise.resolve<EventNow>({ next: null, live: [] })),
    [slug, enabled],
  );
}
