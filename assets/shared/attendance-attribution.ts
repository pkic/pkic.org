/**
 * Session attribution: where a person was, and for how long, from the order
 * of their session check-ins and check-outs.
 *
 * A stay in a session runs from a check-in there until the person's next
 * check-in at another session, their next check-out, or the session's end,
 * whichever comes first, and is clipped to the session's own start and end.
 * Checking in again at the session someone is already in changes nothing;
 * coming back after being elsewhere adds a second stretch to the same stay.
 *
 * A stay counts only when it covers a minimum share of its session's
 * scheduled length (the event's attendance setting, 50% unless changed), so
 * someone who walks in for the last minutes of a talk while waiting for the
 * next one is not counted there. A shorter stay is still reported, marked too
 * short, and is never attributed.
 *
 * When sessions overlap in time, a person is attributed to only one of them:
 * the one they stayed in longest. Counting stays are taken longest first (ties
 * go to the earlier check-in, then the session ID), and a stay is attributed
 * unless its session overlaps one already attributed.
 *
 * Pure policy: the server-side reports run it; the browser never does.
 */
import { z } from "zod";

/** The share of a session's scheduled length a stay must cover to count, in percent. */
export const MINIMUM_STAY_PERCENT = { min: 10, max: 100, default: 50 } as const;

/** The event's attendance settings, kept under `attendance` in its settings. */
export const eventAttendanceSettingsSchema = z
  .object({
    minimumStayPercent: z
      .number({ error: "Enter a whole percentage." })
      .int("Enter a whole percentage.")
      .min(MINIMUM_STAY_PERCENT.min, `Enter at least ${MINIMUM_STAY_PERCENT.min}%.`)
      .max(MINIMUM_STAY_PERCENT.max, `Enter at most ${MINIMUM_STAY_PERCENT.max}%.`),
  })
  .strict();
export type EventAttendanceSettings = z.infer<typeof eventAttendanceSettingsSchema>;

export const DEFAULT_EVENT_ATTENDANCE_SETTINGS: EventAttendanceSettings = {
  minimumStayPercent: MINIMUM_STAY_PERCENT.default,
};

/** The attendance settings stored in an event's settings, or the defaults when none are stored. */
export function eventAttendanceSettings(settings: Record<string, unknown>): EventAttendanceSettings {
  const parsed = eventAttendanceSettingsSchema.safeParse(settings.attendance);
  return parsed.success ? parsed.data : DEFAULT_EVENT_ATTENDANCE_SETTINGS;
}

export interface AttributionSession {
  id: string;
  startAt: string;
  endAt: string;
}

/** One check-in at a session, or a check-out that ends whatever stay is open. */
export type MovementEvent = { kind: "check_in"; sessionId: string; at: string } | { kind: "check_out"; at: string };

export interface SessionStay {
  sessionId: string;
  /** The first check-in at the session. */
  checkedInAt: string;
  /** When the last stretch there ended, clipped to the session's end. */
  leftAt: string;
  /** Whole seconds spent inside the session's own time. */
  dwellSeconds: number;
  /** Shorter than the minimum share of the session; recorded, never attributed. */
  tooShort: boolean;
  attributed: boolean;
}

interface OpenStay {
  sessionId: string;
  since: number;
}

function overlaps(left: AttributionSession, right: AttributionSession): boolean {
  return Date.parse(left.startAt) < Date.parse(right.endAt) && Date.parse(right.startAt) < Date.parse(left.endAt);
}

/** Whether a stay covers the minimum share of its session's scheduled length. */
function longEnough(session: AttributionSession, dwellSeconds: number, minimumStayPercent: number): boolean {
  const lengthSeconds = (Date.parse(session.endAt) - Date.parse(session.startAt)) / 1000;
  return dwellSeconds > 0 && dwellSeconds * 100 >= lengthSeconds * minimumStayPercent;
}

/**
 * One person's stays, in order of first check-in. Events may arrive in any
 * order; check-ins at sessions not in `sessions` are ignored.
 */
export function attributeSessionStays(
  sessions: readonly AttributionSession[],
  events: readonly MovementEvent[],
  minimumStayPercent: number = MINIMUM_STAY_PERCENT.default,
): SessionStay[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const ordered = events
    .map((event, index) => ({ event, index, at: Date.parse(event.at) }))
    .filter(({ event }) => event.kind === "check_out" || byId.has(event.sessionId))
    .sort((left, right) => left.at - right.at || left.index - right.index);
  const stays = new Map<string, { checkedInAt: number; leftAt: number; dwell: number }>();
  let open: OpenStay | null = null;

  /** Adds the open stretch, clipped to its session, up to `until`. */
  const close = (stretch: OpenStay, until: number) => {
    const session = byId.get(stretch.sessionId)!;
    const end = Math.min(until, Date.parse(session.endAt));
    const stay = stays.get(stretch.sessionId)!;
    stay.dwell += Math.max(0, end - Math.max(stretch.since, Date.parse(session.startAt)));
    stay.leftAt = Math.max(stay.leftAt, end);
  };

  for (const { event, at } of ordered) {
    if (event.kind === "check_in" && open?.sessionId === event.sessionId) continue;
    if (open) close(open, at);
    open = null;
    if (event.kind === "check_out") continue;
    if (!stays.has(event.sessionId)) stays.set(event.sessionId, { checkedInAt: at, leftAt: at, dwell: 0 });
    open = { sessionId: event.sessionId, since: at };
  }
  if (open) close(open, Date.parse(byId.get(open.sessionId)!.endAt));

  const result = [...stays.entries()].map(([sessionId, stay]) => {
    const dwellSeconds = Math.floor(stay.dwell / 1000);
    return {
      sessionId,
      checkedInAt: new Date(stay.checkedInAt).toISOString(),
      leftAt: new Date(stay.leftAt).toISOString(),
      dwellSeconds,
      tooShort: !longEnough(byId.get(sessionId)!, dwellSeconds, minimumStayPercent),
      attributed: false,
    };
  });
  const attributed: AttributionSession[] = [];
  const candidates = result
    .filter((stay) => !stay.tooShort)
    .sort(
      (left, right) =>
        right.dwellSeconds - left.dwellSeconds ||
        Date.parse(left.checkedInAt) - Date.parse(right.checkedInAt) ||
        left.sessionId.localeCompare(right.sessionId),
    );
  for (const stay of candidates) {
    const session = byId.get(stay.sessionId)!;
    if (attributed.some((other) => overlaps(session, other))) continue;
    stay.attributed = true;
    attributed.push(session);
  }
  return result.sort(
    (left, right) =>
      Date.parse(left.checkedInAt) - Date.parse(right.checkedInAt) || left.sessionId.localeCompare(right.sessionId),
  );
}
