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
      const known = definitions.get(option.value);
      // A day that does not offer the alternative stores none, so take it from any day that names it.
      if (known && !known.option.waitlistAlternative && option.waitlistAlternative)
        known.option = { ...known.option, waitlistAlternative: option.waitlistAlternative };
      if (known) continue;
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
    days: draft.days.map((day, index) => {
      const entries = dayOptionEntries(draft, index);
      const values = new Set(entries.map(({ definition }) => definition.option.value));
      return {
        date: day.date,
        label: day.label || undefined,
        startTime: day.startTime || undefined,
        endTime: day.endTime || undefined,
        sortOrder: index * 10,
        attendanceOptions: entries.map(({ definition, choice }) => {
          const { waitlistAlternative, ...option } = definition.option;
          return {
            ...option,
            // A day names an alternative only when it has that option too.
            ...(waitlistAlternative && values.has(waitlistAlternative) ? { waitlistAlternative } : {}),
            capacity: choice.capacity,
            ...(choice.enabled ? {} : { enabled: false }),
          };
        }),
      };
    }),
  };
}

/** Apply an edit to one option; options that name it as their waitlist alternative follow a new key. */
export function updateAttendanceDefinition(
  draft: AttendanceSettingsDraft,
  id: string,
  patch: Partial<AttendanceDefinition["option"]>,
): AttendanceSettingsDraft {
  const previous = draft.definitions.find((definition) => definition.id === id)?.option.value;
  const renamed = patch.value !== undefined && previous !== undefined && patch.value !== previous;
  return {
    ...draft,
    definitions: draft.definitions.map((definition) => {
      if (definition.id === id) return { ...definition, option: { ...definition.option, ...patch } };
      if (renamed && definition.option.waitlistAlternative === previous)
        return { ...definition, option: { ...definition.option, waitlistAlternative: patch.value } };
      return definition;
    }),
  };
}

/** Remove an option, and clear it where another option names it as the waitlist alternative. */
export function removeAttendanceDefinition(draft: AttendanceSettingsDraft, id: string): AttendanceSettingsDraft {
  const removed = draft.definitions.find((definition) => definition.id === id)?.option.value;
  return {
    ...draft,
    definitions: draft.definitions
      .filter((definition) => definition.id !== id)
      .map((definition) =>
        removed !== undefined && definition.option.waitlistAlternative === removed
          ? { ...definition, option: { ...definition.option, waitlistAlternative: undefined } }
          : definition,
      ),
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
