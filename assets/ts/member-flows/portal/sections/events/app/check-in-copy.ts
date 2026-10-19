/**
 * What the check-in screens say: the confirmation before recording, and each
 * outcome after. Results never expose how codes work; a refused scan says
 * why in the attendee's terms and what to do next. A check-in is recorded
 * whatever the attendee's registration or booking, and a note tells them how.
 */
import type { AttendancePointRefusal } from "../../../../../../shared/attendance-points";
import type {
  AttendancePointResult,
  AttendancePointTarget,
} from "../../../../../../shared/schemas/event-attendance-points";

/** "Check in to Day 1", "Check in to Opening keynote", "Check out of Day 1". */
export function checkInHeading(target: AttendancePointTarget): string {
  if (target.action === "check_out") return `Check out of ${target.dayLabel}`;
  return `Check in to ${target.session?.title ?? target.dayLabel}`;
}

export function checkInActionLabel(target: AttendancePointTarget): string {
  return target.action === "check_out" ? "Check out" : "Check in";
}

export interface CheckInOutcomeCopy {
  title: string;
  body: string;
  /** Refusals read as a notice; recorded and existing states are plain confirmations. */
  refused: boolean;
}

function place(target: AttendancePointTarget | null): string {
  if (!target) return "";
  return target.session ? target.session.title : target.dayLabel;
}

const REFUSALS: Record<AttendancePointRefusal, (target: AttendancePointTarget | null) => CheckInOutcomeCopy> = {
  invalid_code: () => ({
    title: "This code doesn't work",
    body: "It may have been replaced. Scan a code at the venue, or ask at the registration desk.",
    refused: true,
  }),
  not_event_day: () => ({
    title: "No check-in today",
    body: "Check-in opens on the days of the event.",
    refused: true,
  }),
  wrong_day: (target) => ({
    title: "This code is for another day",
    body: `It checks you in to ${target?.dayLabel ?? "another day"}. Scan today's code instead.`,
    refused: true,
  }),
  not_checked_in: () => ({
    title: "You're not checked in",
    body: "Check in at the entrance first. You can check out after that.",
    refused: true,
  }),
  no_session: (target) => ({
    title: "No session here right now",
    body: `Nothing is running in ${target?.room?.name ?? "this room"}. Scan again shortly before the next session starts.`,
    refused: true,
  }),
  session_not_open: (target) => ({
    title: "Check-in hasn't opened yet",
    body: `Check-in for ${place(target) || "this session"} opens 30 minutes before it starts.`,
    refused: true,
  }),
  session_ended: (target) => ({
    title: "This session has ended",
    body: `${place(target) || "The session"} is over, so it no longer takes check-ins.`,
    refused: true,
  }),
  closed: () => ({
    title: "Check-in has closed",
    body: "Attendance is no longer recorded for this event.",
    refused: true,
  }),
  daily_limit: () => ({
    title: "Too many scans today",
    body: "You've checked in and out more times today than we can record. Ask at the registration desk if you need help.",
    refused: true,
  }),
};

export interface CheckInNote {
  tone: "info" | "warn";
  text: string;
}

/**
 * What the attendee should know about how the check-in is recorded: before
 * confirming (`recorded` false) and after. Nothing when they hold an
 * in-person place and, for a session, the seat it asks for.
 */
export function checkInNotes(result: AttendancePointResult, recorded: boolean): CheckInNote[] {
  const target = result.target;
  if (!target || result.status === "refused") return [];
  const day = target.dayLabel;
  const notes: CheckInNote[] = [];
  const seen = recorded ? "Your check-in is recorded, and the organizers can see it." : "You can still check in.";
  switch (result.standing) {
    case "remote":
      notes.push({
        tone: "info",
        text: `You're registered to join ${day} online, so this counts as online attendance, not in person.`,
      });
      break;
    case "not_registered":
      notes.push({ tone: "warn", text: `You're not registered for in-person attendance on ${day}. ${seen}` });
      break;
    case "no_in_person_place":
      notes.push({
        tone: "warn",
        text: `You don't have an in-person place for ${day} yet. ${seen} Ask at the registration desk about a place.`,
      });
      break;
  }
  if (target.session && result.booked === false)
    notes.push({
      tone: "warn",
      text: recorded
        ? "No seat booked for this session. Your check-in is recorded."
        : "No seat booked for this session. If you found a free seat, you can still check in.",
    });
  return notes;
}

/** The outcome screen for any result other than `ready`. */
export function checkInOutcome(result: AttendancePointResult): CheckInOutcomeCopy {
  const target = result.target;
  switch (result.status) {
    case "checked_in":
      return { title: "You're checked in", body: `Welcome to ${place(target)}.`, refused: false };
    case "already_checked_in":
      return {
        title: "You're checked in",
        body: `You already checked in to ${place(target)}. There's nothing more to do.`,
        refused: false,
      };
    case "checked_out":
      return {
        title: "You're checked out",
        body: `Thanks for letting us know you've left ${target?.dayLabel ?? "the venue"}.`,
        refused: false,
      };
    case "already_checked_out":
      return { title: "You're checked out", body: "You already checked out.", refused: false };
    case "refused":
      return REFUSALS[result.reason ?? "invalid_code"](target);
    case "ready":
      return { title: target ? checkInHeading(target) : "", body: "", refused: false };
  }
}
