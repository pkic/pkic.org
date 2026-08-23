import type { AdminAttendanceOption, AdminEventDay } from "../../../types";
import { api } from "../../../api";
import { adminEventDaysResponseSchema } from "../../../../../shared/schemas/admin-events";

export function collectAttendanceOptions(days: AdminEventDay[]): AdminAttendanceOption[] {
  const optionsByValue = new Map<string, AdminAttendanceOption>();

  for (const day of days) {
    for (const option of day.attendanceOptions ?? []) {
      if (!optionsByValue.has(option.value)) {
        optionsByValue.set(option.value, option);
      }
    }
  }

  return [...optionsByValue.values()];
}

export async function loadEventAttendanceOptions(
  slug: string,
  purpose: "event_registration" | "proposal_submission",
): Promise<AdminAttendanceOption[]> {
  if (purpose !== "event_registration") return [];

  const data = await api(`/api/v1/admin/events/${slug}/days`, adminEventDaysResponseSchema);
  return collectAttendanceOptions(data.days ?? []);
}
