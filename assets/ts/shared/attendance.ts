import type { EventAttendanceOption } from "../../shared/schemas/event-configuration";

export const ATTENDANCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  in_person: "In-person",
  virtual: "Virtual",
  on_demand: "On-demand",
  not_attending: "Not attending",
};

/** Return a readable label for known and future attendance types. */
export function attendanceTypeLabel(type: string | null | undefined): string {
  if (!type) return "Not specified";
  const knownLabel = ATTENDANCE_TYPE_LABELS[type];
  if (knownLabel) return knownLabel;

  const normalized = type.replaceAll("_", " ").trim();
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : "Not specified";
}

/**
 * The attendance options an event's settings offer across its days, in the
 * order they are configured: one per value, the first day's wording kept and
 * an icon a later day sets filled in when the first left it out.
 */
export function eventAttendanceOptions(
  days: readonly { attendanceOptions: readonly EventAttendanceOption[] }[],
): EventAttendanceOption[] {
  const options = new Map<string, EventAttendanceOption>();
  for (const day of days)
    for (const option of day.attendanceOptions) {
      const previous = options.get(option.value);
      options.set(option.value, previous ? { ...option, ...previous, icon: previous.icon ?? option.icon } : option);
    }
  return [...options.values()];
}
