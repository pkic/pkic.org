import type {
  EventAttendanceOption,
  EventDaysManagementResponse,
  EventDaysReplaceInput,
} from "../../../../../shared/schemas/event-configuration";
import { zonedClock } from "../../../../../shared/timezone";

export type AttendanceDefinition = {
  id: string;
  originalValue: string;
  option: Omit<EventAttendanceOption, "capacity" | "enabled">;
};
export type AttendanceDayDraft = {
  id: string;
  date: string;
  label: string;
  startTime: string;
  endTime: string;
  choices: Record<string, { enabled: boolean; capacity: number | null }>;
  counts: Record<string, number>;
};
export type AttendanceSettingsDraft = { definitions: AttendanceDefinition[]; days: AttendanceDayDraft[] };

export function attendanceSettingsDraft(response: EventDaysManagementResponse, zone: string): AttendanceSettingsDraft {
  const definitions = new Map<string, AttendanceDefinition>();
  for (const day of response.days)
    for (const option of day.attendanceOptions) {
      if (definitions.has(option.value)) continue;
      const { capacity: _capacity, enabled: _enabled, ...metadata } = option;
      definitions.set(option.value, { id: crypto.randomUUID(), originalValue: option.value, option: metadata });
    }
  return {
    definitions: [...definitions.values()],
    days: response.days
      .map((day) => ({
        id: day.id,
        date: day.date,
        label: day.label ?? "",
        startTime: day.startsAt ? zonedClock(new Date(day.startsAt), zone) : "",
        endTime: day.endsAt ? zonedClock(new Date(day.endsAt), zone) : "",
        counts: day.attendanceCounts,
        choices: Object.fromEntries(
          day.attendanceOptions.map((option) => [
            definitions.get(option.value)!.id,
            {
              enabled: option.enabled !== false,
              capacity: option.capacity ?? null,
            },
          ]),
        ),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Keep an unoffered definition on one existing day, rather than losing it on save. */
export function dayOptionEntries(draft: AttendanceSettingsDraft, dayIndex: number) {
  const day = draft.days[dayIndex];
  return draft.definitions.flatMap((definition) => {
    const choice = day.choices[definition.id];
    if (choice) return [{ definition, choice }];
    if (dayIndex === 0 && !draft.days.some((candidate) => candidate.choices[definition.id]))
      return [{ definition, choice: { enabled: false, capacity: null } }];
    return [];
  });
}

export function attendanceConfiguration(draft: AttendanceSettingsDraft): EventDaysReplaceInput {
  return {
    days: draft.days.map((day, index) => ({
      date: day.date,
      label: day.label || undefined,
      startTime: day.startTime || undefined,
      endTime: day.endTime || undefined,
      sortOrder: index * 10,
      attendanceOptions: dayOptionEntries(draft, index).map(({ definition, choice }) => ({
        ...definition.option,
        capacity: choice.capacity,
        ...(choice.enabled ? {} : { enabled: false }),
      })),
    })),
  };
}

export function optionFieldPrefix(draft: AttendanceSettingsDraft, definitionId: string): string {
  for (let index = 0; index < draft.days.length; index++) {
    const optionIndex = dayOptionEntries(draft, index).findIndex(({ definition }) => definition.id === definitionId);
    if (optionIndex >= 0) return `configuration.days.${index}.attendanceOptions.${optionIndex}`;
  }
  return "configuration.days";
}

export function optionInUse(draft: AttendanceSettingsDraft, definition: AttendanceDefinition): boolean {
  return draft.days.some((day) => (day.counts[definition.originalValue] ?? 0) > 0);
}

export function addAttendanceDay(draft: AttendanceSettingsDraft): AttendanceSettingsDraft {
  return {
    ...draft,
    days: [
      ...draft.days,
      {
        id: crypto.randomUUID(),
        date: "",
        label: "",
        startTime: "",
        endTime: "",
        counts: {},
        choices: Object.fromEntries(
          draft.definitions.map((definition) => [definition.id, { enabled: true, capacity: null }]),
        ),
      },
    ],
  };
}
