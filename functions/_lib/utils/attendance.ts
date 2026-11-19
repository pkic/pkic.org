import {
  eventAttendanceAccessMode,
  type EventAttendanceAccessMode,
} from "../../../assets/shared/event-attendance-access";
import type {
  EmailDayAttendance,
  EmailDayWaitlist,
  EmailWaitlistAlternative,
} from "../../../assets/shared/schemas/email-template-data";
import { eventAttendanceOptionSchema } from "../../../assets/shared/schemas/event-configuration";
import { parseJsonSafe } from "./json";
/**
 * Human-readable labels for registration attendance type values.
 */
export const ATTENDANCE_TYPE_LABELS: Record<string, string> = {
  in_person: "In person",
  virtual: "Virtual (online)",
  on_demand: "On demand",
};

/**
 * Human-readable labels for registration status values.
 */
export const STATUS_LABELS: Record<string, string> = {
  registered: "Confirmed",
  cancelled: "Cancelled",
  pending_email_confirmation: "Pending confirmation",
};

type DayWaitlistEmailEntry = EmailDayWaitlist;

/**
 * Whether a day attended at the venue gets the person in. Only a confirmed day does, so every
 * venue day says which it is; a day attended remotely needs no note.
 */
const VENUE_DAY_NOTES: Record<string, string> = {
  "": "confirmed",
  accepted: "confirmed",
  waiting: "waitlisted, not confirmed",
  offered: "seat offered, not confirmed until you accept it",
  expired: "offer expired, not confirmed",
};

export function hasActiveDayWaitlist(dayWaitlist: DayWaitlistEmailEntry[] = []): boolean {
  return dayWaitlist.some((entry) => entry.status === "waiting" || entry.status === "offered");
}

export function buildRegistrationEmailStatusData(
  registrationStatus: string,
  dayWaitlist: DayWaitlistEmailEntry[] = [],
): {
  status: string;
  statusLabel: string;
  registrationStatus: string;
  registrationStatusLabel: string;
  isWaitlisted: boolean;
  hasDayWaitlist: boolean;
  hasActiveDayWaitlist: boolean;
  waitlistedDayCount: number;
} {
  const activeDayWaitlist = dayWaitlist.filter((entry) => entry.status === "waiting" || entry.status === "offered");
  const isWaitlisted = activeDayWaitlist.length > 0;

  return {
    status: registrationStatus,
    statusLabel: STATUS_LABELS[registrationStatus] ?? registrationStatus,
    registrationStatus,
    registrationStatusLabel: STATUS_LABELS[registrationStatus] ?? registrationStatus,
    isWaitlisted,
    hasDayWaitlist: dayWaitlist.length > 0,
    hasActiveDayWaitlist: activeDayWaitlist.length > 0,
    waitlistedDayCount: activeDayWaitlist.length,
  };
}

/**
 * Build structured attendance data for email templates.
 *
 * A registration with no selected days has no attendance label.
 *
 * Day labels come from the event_days.label column (e.g. "Tuesday 1 December 2026"),
 * falling back to the ISO day_date if no label is set.
 */
export function buildAttendanceEmailData(
  dayAttendance: Array<{
    dayDate: string;
    attendanceType: string;
    label: string | null;
    optionLabel?: string | null;
    accessMode?: EventAttendanceAccessMode;
    /** The configured option the day suggests when its own option is full, as stored JSON. */
    waitlistAlternativeJson?: string | null;
  }>,
  dayWaitlist: DayWaitlistEmailEntry[] = [],
): {
  attendanceLabel: string;
  dayAttendance: EmailDayAttendance[];
  waitlistAlternatives: EmailWaitlistAlternative[];
} {
  const waitlistByDay = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry.status]));

  if (dayAttendance.length > 0) {
    return {
      attendanceLabel: "",
      waitlistAlternatives: waitlistAlternatives(dayAttendance, waitlistByDay),
      dayAttendance: dayAttendance.map((d) => {
        const waitlistStatus = waitlistByDay.get(d.dayDate) ?? "";
        return {
          dayLabel: d.label ?? d.dayDate,
          attendanceLabel: d.optionLabel ?? ATTENDANCE_TYPE_LABELS[d.attendanceType] ?? d.attendanceType,
          statusLabel: buildDayAttendanceStatusLabel(d.attendanceType, waitlistStatus, d.optionLabel),
          statusNote:
            eventAttendanceAccessMode({ value: d.attendanceType, accessMode: d.accessMode }) === "physical"
              ? (VENUE_DAY_NOTES[waitlistStatus] ?? "not confirmed")
              : "",
          waitlistStatus,
          isWaitlisted: waitlistStatus === "waiting",
          isWaitlistOffer: waitlistStatus === "offered",
        };
      }),
    };
  }

  return {
    attendanceLabel: "",
    dayAttendance: [],
    waitlistAlternatives: [],
  };
}

/**
 * The options to suggest for venue days still on the waitlist, each once. Only the organizer's
 * label and description say what they are; the email adds no event-specific wording.
 */
function waitlistAlternatives(
  dayAttendance: ReadonlyArray<{
    dayDate: string;
    attendanceType: string;
    accessMode?: EventAttendanceAccessMode;
    waitlistAlternativeJson?: string | null;
  }>,
  waitlistByDay: ReadonlyMap<string, string>,
): EmailWaitlistAlternative[] {
  const suggested = new Map<string, EmailWaitlistAlternative>();
  for (const day of dayAttendance) {
    // A held offer is the person's seat to claim, so only a day still waiting gets a suggestion.
    if (waitlistByDay.get(day.dayDate) !== "waiting") continue;
    if (eventAttendanceAccessMode({ value: day.attendanceType, accessMode: day.accessMode }) !== "physical") continue;
    const parsed = day.waitlistAlternativeJson
      ? eventAttendanceOptionSchema.safeParse(parseJsonSafe<unknown>(day.waitlistAlternativeJson, null))
      : null;
    if (!parsed?.success || parsed.data.enabled === false) continue;
    const description = (parsed.data.description ?? "").replace(/[.\s]+$/, "");
    const limited = parsed.data.capacity != null;
    const key = `${parsed.data.label}\u0000${description}`;
    const known = suggested.get(key);
    suggested.set(key, { label: parsed.data.label, description, limited: limited || Boolean(known?.limited) });
  }
  return [...suggested.values()];
}

function buildDayAttendanceStatusLabel(
  attendanceType: string,
  waitlistStatus: string | undefined,
  optionLabel?: string | null,
): string {
  if (waitlistStatus === "expired") {
    return "Offer expired";
  }
  if (waitlistStatus === "offered") {
    return "Waitlist offer sent";
  }

  if (waitlistStatus === "waiting") {
    return attendanceType === "in_person" ? "Waitlisted for in-person attendance" : "Waitlisted";
  }

  if (waitlistStatus === "accepted") {
    return attendanceType === "in_person" ? "Confirmed in-person attendance" : "Attendance confirmed";
  }

  switch (attendanceType) {
    case "in_person":
      return "Confirmed in-person attendance";
    case "virtual":
      return "Virtual attendance";
    case "on_demand":
      return "On-demand attendance";
    default:
      return optionLabel ?? ATTENDANCE_TYPE_LABELS[attendanceType] ?? attendanceType;
  }
}
