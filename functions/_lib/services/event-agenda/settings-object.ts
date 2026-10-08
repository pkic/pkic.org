import { AppError } from "../../errors";

/** Legacy null containers may be initialized; malformed non-object settings must not be silently replaced. */
export function agendaSettingsObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new AppError(409, "AGENDA_SETTINGS_CHANGED", "Refresh the agenda settings before saving.");
  return value as Record<string, unknown>;
}

/** The owning namespace is written as an object even if a legacy root or ancestor was explicitly null. */
export const agendaSettingsWriteSql =
  "json_set(CASE WHEN json_type(settings_json)='null' THEN '{}' ELSE settings_json END,'$.agenda',json(?))";
