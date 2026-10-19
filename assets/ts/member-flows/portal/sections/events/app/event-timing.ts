/**
 * Where an event or one of its sessions stands relative to now, in the words
 * the event app shows: "Live now", "Starts in 3 days", "Ended". Instants are
 * UTC from the API; only the relative wording is computed here, and the
 * day count reuses the shared relative-days formatter.
 */
import { formatRelativeDays } from "../../../ui";

export type EventPhaseKind = "unscheduled" | "upcoming" | "live" | "ended";

export interface EventPhase {
  kind: EventPhaseKind;
  label: string | null;
}

/** An instant as epoch milliseconds, or null when absent or unreadable. */
function epoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function eventPhase(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  now = Date.now(),
): EventPhase {
  const start = epoch(startsAt);
  if (start === null) return { kind: "unscheduled", label: null };
  const end = epoch(endsAt) ?? start;
  if (now < start) {
    const relative = formatRelativeDays(startsAt);
    return { kind: "upcoming", label: relative ? `Starts ${relative}` : "Upcoming" };
  }
  if (now <= end) return { kind: "live", label: "Live now" };
  return { kind: "ended", label: "Ended" };
}

/** Sessions about to begin within this window are called out as "Starting soon". */
export const SESSION_SOON_MS = 30 * 60_000;

export type SessionPhaseKind = "later" | "soon" | "live" | "ended" | "unscheduled";

export function sessionPhase(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  now = Date.now(),
): SessionPhaseKind {
  const start = epoch(startAt);
  if (start === null) return "unscheduled";
  const end = epoch(endAt) ?? start;
  if (now >= start && now < end) return "live";
  if (now >= end) return "ended";
  return start - now <= SESSION_SOON_MS ? "soon" : "later";
}
