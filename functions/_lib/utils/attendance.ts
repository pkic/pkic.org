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
  cancelled_unauthorized: "Cancelled (unauthorized)",
  pending_email_confirmation: "Pending confirmation",
};

type DayWaitlistEmailEntry = { dayDate: string; status: string };

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
 * Returns either:
 * - `dayAttendance` as a non-empty array for multi-day registrations, with
 *   `attendanceLabel` left empty (the template uses {{#each dayAttendance}})
 * - `attendanceLabel` as a single human-readable string for non-per-day
 *   registrations, with `dayAttendance` as an empty array
 *
 * Day labels come from the event_days.label column (e.g. "Tuesday 1 December 2026"),
 * falling back to the ISO day_date if no label is set.
 */
export function buildAttendanceEmailData(
  attendanceType: string,
  dayAttendance: Array<{ dayDate: string; attendanceType: string; label: string | null }>,
  dayWaitlist: DayWaitlistEmailEntry[] = [],
): {
  attendanceLabel: string;
  dayAttendance: Array<{
    dayLabel: string;
    attendanceLabel: string;
    statusLabel: string;
    waitlistStatus: string;
    isWaitlisted: boolean;
    isWaitlistOffer: boolean;
  }>;
} {
  const waitlistByDay = new Map(dayWaitlist.map((entry) => [entry.dayDate, entry.status]));

  if (dayAttendance.length > 0) {
    return {
      attendanceLabel: "",
      dayAttendance: dayAttendance.map((d) => {
        const waitlistStatus = waitlistByDay.get(d.dayDate) ?? "";
        return {
          dayLabel: d.label ?? d.dayDate,
          attendanceLabel: ATTENDANCE_TYPE_LABELS[d.attendanceType] ?? d.attendanceType,
          statusLabel: buildDayAttendanceStatusLabel(d.attendanceType, waitlistStatus),
          waitlistStatus,
          isWaitlisted: waitlistStatus === "waiting",
          isWaitlistOffer: waitlistStatus === "offered",
        };
      }),
    };
  }

  return {
    attendanceLabel: ATTENDANCE_TYPE_LABELS[attendanceType] ?? attendanceType,
    dayAttendance: [],
  };
}

function buildDayAttendanceStatusLabel(attendanceType: string, waitlistStatus: string | undefined): string {
  if (waitlistStatus === "offered") {
    return "Waitlist offer sent";
  }

  if (waitlistStatus === "waiting") {
    return "Waitlisted for in-person attendance";
  }

  if (waitlistStatus === "accepted") {
    return "Confirmed in-person attendance";
  }

  switch (attendanceType) {
    case "in_person":
      return "Confirmed in-person attendance";
    case "virtual":
      return "Virtual attendance";
    case "on_demand":
      return "On-demand attendance";
    default:
      return ATTENDANCE_TYPE_LABELS[attendanceType] ?? attendanceType;
  }
}
