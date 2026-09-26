import type { FormFieldDefinition } from "../services/forms";
import { parseFormFieldOptions } from "../../../assets/shared/schemas/form-field-rules";
import { parseJsonSafe } from "./json";

type CustomAnswerField = Pick<FormFieldDefinition, "options">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCustomAnswerObject(value: Record<string, unknown>): string {
  if ("start" in value || "end" in value) {
    const start = value.start == null ? "" : String(value.start);
    const end = value.end == null ? "" : String(value.end);
    if (start || end) return start && end ? `${start} – ${end}` : start || end;
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

/** Formats persisted custom answers for every server-side registration surface. */
export function formatCustomAnswerValue(value: unknown, field?: CustomAnswerField): string {
  const optionLabels = new Map(parseFormFieldOptions(field?.options).map((option) => [option.value, option.label]));
  const format = (entry: unknown): string => {
    if (entry === null || entry === undefined) return "";
    if (Array.isArray(entry)) return entry.map(format).filter(Boolean).join(", ");
    if (typeof entry === "boolean") return entry ? "Yes" : "No";
    if (isRecord(entry)) return formatCustomAnswerObject(entry);
    const text = String(entry);
    return optionLabels.get(text) ?? text;
  };

  return format(value);
}

export function isCustomAnswerRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function parseCustomAnswerRecord(value: string | null | undefined): Record<string, unknown> | null {
  const parsed = parseJsonSafe<unknown>(value, null);
  return isRecord(parsed) ? parsed : null;
}
