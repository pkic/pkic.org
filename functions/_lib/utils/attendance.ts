import {
  eventAttendanceAccessMode,
  type EventAttendanceAccessMode,
} from "../../../assets/shared/event-attendance-access";
import type { EmailDayAttendance, EmailDayWaitlist } from "../../../assets/shared/schemas/email-template-data";
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
  waiting: "waitlisted",
  offered: "waitlisted, seat offered",
  expired: "waitlisted, offer expired",
};

/** Which kinds of unconfirmed venue day a registration has, so one notice explains each next step. */
export type VenueDayStanding = {
  hasUnconfirmedVenueDay: boolean;
  hasWaitingVenueDay: boolean;
  hasOfferedVenueDay: boolean;
  hasExpiredVenueDay: boolean;
};

function venueDayStanding(days: Array<{ statusNote: string; waitlistStatus: string }>): VenueDayStanding {
  const unconfirmed = days.filter((day) => day.statusNote && day.statusNote !== VENUE_DAY_NOTES[""]);
  return {
    hasUnconfirmedVenueDay: unconfirmed.length > 0,
    hasWaitingVenueDay: unconfirmed.some((day) => day.waitlistStatus !== "offered" && day.waitlistStatus !== "expired"),
    hasOfferedVenueDay: unconfirmed.some((day) => day.waitlistStatus === "offered"),
    hasExpiredVenueDay: unconfirmed.some((day) => day.waitlistStatus === "expired"),
  };
}

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
  }>,
  dayWaitlist: DayWaitlistEmailEntry[] = [],
): {
  attendanceLabel: string;
  dayAttendance: EmailDayAttendance[];
  venueDayStanding: VenueDayStanding;
} {
  const waitlistByDay = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry.status]));

  if (dayAttendance.length > 0) {
    const days = dayAttendance.map((d) => {
      const waitlistStatus = waitlistByDay.get(d.dayDate) ?? "";
      return {
        dayLabel: d.label ?? d.dayDate,
        attendanceLabel: d.optionLabel ?? ATTENDANCE_TYPE_LABELS[d.attendanceType] ?? d.attendanceType,
        statusLabel: buildDayAttendanceStatusLabel(d.attendanceType, waitlistStatus, d.optionLabel),
        statusNote:
          eventAttendanceAccessMode({ value: d.attendanceType, accessMode: d.accessMode }) === "physical"
            ? (VENUE_DAY_NOTES[waitlistStatus] ?? "waitlisted")
            : "",
        waitlistStatus,
        isWaitlisted: waitlistStatus === "waiting",
        isWaitlistOffer: waitlistStatus === "offered",
      };
    });
    return { attendanceLabel: "", dayAttendance: days, venueDayStanding: venueDayStanding(days) };
  }

  return {
    attendanceLabel: "",
    dayAttendance: [],
    venueDayStanding: venueDayStanding([]),
  };
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
