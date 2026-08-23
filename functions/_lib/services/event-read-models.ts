import type { EventDayReadModel, RequiredTerm } from "../../../assets/shared/schemas/event-read-models";
import { resolveAttendanceOptions, type EventDayRecord } from "./event-days";
import type { EventTermRecord } from "./event-types";

/** Maps the D1 event-term row once for every public event workflow. */
export function requiredTermReadModel(term: EventTermRecord): RequiredTerm {
  return {
    termKey: term.term_key,
    version: term.version,
    required: term.required === 1,
    contentRef: term.content_ref,
    displayText: term.display_text,
    helpText: term.help_text ?? null,
  };
}

/**
 * Builds the canonical event-day projection from one grouped D1 count query.
 * The caller owns fetching days and counts so it can batch those reads with
 * other endpoint-specific work without introducing an N+1 query pattern.
 */
export function eventDayReadModels(
  eventDays: EventDayRecord[],
  registeredCounts: Map<string, Map<string, number>>,
): EventDayReadModel[] {
  return eventDays.map((day) => ({
    dayDate: day.day_date,
    label: day.label,
    inPersonCapacity: day.in_person_capacity,
    sortOrder: day.sort_order,
    attendanceOptions: resolveAttendanceOptions(day).map((option) => {
      const capacity = option.capacity ?? null;
      const registered = registeredCounts.get(day.id)?.get(option.value) ?? 0;
      return {
        value: option.value,
        label: option.label,
        spotsRemainingPercent:
          capacity != null && capacity > 0 ? Math.round(((capacity - registered) / capacity) * 100) : null,
      };
    }),
  }));
}
