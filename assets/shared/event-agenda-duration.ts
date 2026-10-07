import { agendaDurationRulesSchema } from "./schemas/event-agenda-duration";
export {
  DEFAULT_AGENDA_SESSION_DURATION_MINUTES,
  AGENDA_SESSION_DURATION_OPTIONS,
} from "./schemas/event-agenda-duration";

/** Older events retain the established authoring defaults; only the owned settings leaf is read. */
export function readAgendaDurationRules(settingsJson: string | null | undefined) {
  let value: unknown;
  try {
    value = settingsJson ? JSON.parse(settingsJson) : {};
  } catch {
    value = {};
  }
  return resolveAgendaDurationRules(
    typeof value === "object" &&
      value !== null &&
      "agenda" in value &&
      typeof value.agenda === "object" &&
      value.agenda !== null &&
      "durationRules" in value.agenda
      ? value.agenda.durationRules
      : {},
  );
}

export function resolveAgendaDurationRules(value: unknown) {
  const settings = agendaDurationRulesSchema.safeParse(value ?? {});
  return settings.success ? settings.data : agendaDurationRulesSchema.parse({});
}
