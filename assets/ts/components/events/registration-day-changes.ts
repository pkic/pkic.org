/**
 * What one registration day is: attending, waiting for or offered an
 * in-person seat, or not attending — a day missing from `dayAttendance`,
 * since there is no stored "not attending" type.
 */
import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { attendanceTypeLabel } from "../../shared/attendance";

export const IN_PERSON = "in_person";

export type DayState =
  | { kind: "attending"; attendanceType: string }
  | { kind: "waiting"; attendanceType: string | null }
  | { kind: "offered"; attendanceType: string | null; offerExpiresAt: string | null }
  | { kind: "absent" };

export interface RegistrationDayView {
  dayDate: string;
  label: string | null;
  state: DayState;
}

export function registrationDays(data: RegistrationManageReadResponse): RegistrationDayView[] {
  const attendance = new Map(data.dayAttendance.map((entry) => [entry.dayDate, entry.attendanceType]));
  const waitlist = new Map(data.dayWaitlist.map((entry) => [entry.dayDate, entry]));
  return [...data.eventDays]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.dayDate.localeCompare(b.dayDate))
    .map((day) => {
      const current = attendance.get(day.dayDate) ?? null;
      const queued = waitlist.get(day.dayDate);
      const state: DayState =
        queued?.status === "offered"
          ? { kind: "offered", attendanceType: current, offerExpiresAt: queued.offerExpiresAt }
          : queued?.status === "waiting"
            ? { kind: "waiting", attendanceType: current }
            : current
              ? { kind: "attending", attendanceType: current }
              : { kind: "absent" };
      return { dayDate: day.dayDate, label: day.label, state };
    });
}

/** The words for a day's state, without relying on the badge colour. */
export function dayStateLabel(state: DayState): string {
  switch (state.kind) {
    case "attending":
      return attendanceTypeLabel(state.attendanceType);
    case "waiting":
      return state.attendanceType
        ? `${attendanceTypeLabel(state.attendanceType)} · waiting for an in-person seat`
        : "Waiting for an in-person seat";
    case "offered":
      return "An in-person seat is yours to claim";
    case "absent":
      return "Not attending";
  }
}
