import type {
  EventAttendanceOption,
  EventDaysManagementResponse,
  EventDaysReplaceInput,
} from "../../../../../shared/schemas/event-configuration";
import { eventAttendanceAccessMode } from "../../../../../shared/event-attendance-access";
import { zonedClock } from "../../../../../shared/timezone";

export type AttendanceDefinition = {
  id: string;
  originalValue: string;
  option: Omit<EventAttendanceOption, "capacity" | "enabled">;
};
/**
 * One option on one day. `waitlistAlternative` is what that day suggests: `null` names none, and a
 * choice without the key (a day added in the editor) takes the option's value.
 */
export type AttendanceDayChoice = { enabled: boolean; capacity: number | null; waitlistAlternative?: string | null };
export type AttendanceDayDraft = {
  id: string;
  date: string;
  label: string;
  startTime: string;
  endTime: string;
  choices: Record<string, AttendanceDayChoice>;
  counts: Record<string, number>;
};
export type AttendanceSettingsDraft = { definitions: AttendanceDefinition[]; days: AttendanceDayDraft[] };

export function attendanceSettingsDraft(response: EventDaysManagementResponse, zone: string): AttendanceSettingsDraft {
  const definitions = new Map<string, AttendanceDefinition>();
  for (const day of response.days)
    for (const option of day.attendanceOptions) {
      const known = definitions.get(option.value);
      // The editor shows the first alternative any day names; each day keeps its own until it is edited.
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
              waitlistAlternative: option.waitlistAlternative ?? null,
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
          const { waitlistAlternative: shared, ...option } = definition.option;
          const waitlistAlternative =
            choice.waitlistAlternative === undefined ? shared : (choice.waitlistAlternative ?? undefined);
          // Only a venue option suggests one, and a day names it only when it has that option too.
          const suggests =
            waitlistAlternative !== undefined &&
            values.has(waitlistAlternative) &&
            eventAttendanceAccessMode(option) === "physical";
          return {
            ...option,
            ...(suggests ? { waitlistAlternative } : {}),
            capacity: choice.capacity,
            ...(choice.enabled ? {} : { enabled: false }),
          };
        }),
      };
    }),
  };
}

/** Point the day choices that name `from` at `to`, or at none. */
function retargetDayAlternatives(days: AttendanceDayDraft[], from: string, to: string | null): AttendanceDayDraft[] {
  return days.map((day) => ({
    ...day,
    choices: Object.fromEntries(
      Object.entries(day.choices).map(([id, choice]) => [
        id,
        choice.waitlistAlternative === from ? { ...choice, waitlistAlternative: to } : choice,
      ]),
    ),
  }));
}

/**
 * Apply an edit to one option. Choosing its alternative sets it on every day; a venue option made
 * remote suggests none; options that name it follow a new key.
 */
export function updateAttendanceDefinition(
  draft: AttendanceSettingsDraft,
  id: string,
  patch: Partial<AttendanceDefinition["option"]>,
): AttendanceSettingsDraft {
  const edited = draft.definitions.find((definition) => definition.id === id);
  if (!edited) return draft;
  const previous = edited.option.value;
  const option = { ...edited.option, ...patch };
  const physical = eventAttendanceAccessMode(option) === "physical";
  if (!physical) delete option.waitlistAlternative;
  const resetDays = "waitlistAlternative" in patch || !physical;
  const renamed = patch.value !== undefined && patch.value !== previous;
  let days = resetDays
    ? draft.days.map((day) => {
        const choice = day.choices[id];
        if (!choice) return day;
        const { waitlistAlternative: _own, ...rest } = choice;
        return { ...day, choices: { ...day.choices, [id]: rest } };
      })
    : draft.days;
  if (renamed) days = retargetDayAlternatives(days, previous, option.value);
  return {
    days,
    definitions: draft.definitions.map((definition) => {
      if (definition.id === id) return { ...definition, option };
      if (renamed && definition.option.waitlistAlternative === previous)
        return { ...definition, option: { ...definition.option, waitlistAlternative: patch.value } };
      return definition;
    }),
  };
}

/** Remove an option, and clear it where another option names it as the waitlist alternative. */
export function removeAttendanceDefinition(draft: AttendanceSettingsDraft, id: string): AttendanceSettingsDraft {
  const removed = draft.definitions.find((definition) => definition.id === id)?.option.value;
  if (removed === undefined) return draft;
  return {
    days: retargetDayAlternatives(draft.days, removed, null),
    definitions: draft.definitions
      .filter((definition) => definition.id !== id)
      .map((definition) =>
        definition.option.waitlistAlternative === removed
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
