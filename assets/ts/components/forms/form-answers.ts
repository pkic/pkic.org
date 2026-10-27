/**
 * One submission's answers, resolved from raw JSON into display rows.
 *
 * Pure value logic with no markup: the same rows feed the answer list on a
 * detail page and the compact cell in the submissions table, and the response
 * statistics need the option-label map without pulling a view in with it.
 */

import type { FormFieldDefinition } from "../../../shared/schemas/forms";
import { parseFormFieldOptions } from "../../../shared/schemas/form-field-rules";
import { countryByCode } from "../../shared/countries";

export interface FormAnswerRow {
  key: string;
  label: string;
  values: string[];
  kind: "text" | "list" | "pre";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionLabelMap(options: unknown): Map<string, string> {
  return new Map(parseFormFieldOptions(options).map((option) => [option.value, option.label]));
}

function stringifyAnswer(value: unknown): string {
  if (typeof value === "string") return value.trim().length > 0 ? value : "-";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null) return "-";
  return JSON.stringify(value, null, 2);
}

export function formatFormAnswerValue(
  value: unknown,
  field?: Pick<FormFieldDefinition, "options" | "validation">,
): string[] {
  const labels = optionLabelMap(field?.options);
  // A country is stored as its ISO code ("NL") and read by people as its name.
  if (field?.validation?.format === "iso_country" && typeof value === "string" && value.trim()) {
    return [countryByCode(value.trim())?.label ?? value];
  }

  if (isRecord(value) && typeof value.start === "string" && typeof value.end === "string")
    return value.start.trim() && value.end.trim() ? [`${value.start.trim()} to ${value.end.trim()}`] : ["-"];

  if (Array.isArray(value)) {
    if (value.length === 0) return ["-"];
    return value.map((entry) => (typeof entry === "string" ? (labels.get(entry) ?? entry) : stringifyAnswer(entry)));
  }

  if (typeof value === "string") return [labels.get(value) ?? stringifyAnswer(value)];
  return [stringifyAnswer(value)];
}

function answerKind(value: unknown, formatted: string[]): FormAnswerRow["kind"] {
  if (Array.isArray(value) && formatted.length > 1) return "list";
  if ((isRecord(value) || (Array.isArray(value) && formatted.length === 1)) && formatted[0] !== "-") return "pre";
  if (formatted.some((entry) => entry.includes("\n"))) return "pre";
  return "text";
}

export function buildFormAnswerRows(
  answers: Record<string, unknown> | null | undefined,
  fields: FormFieldDefinition[] | null | undefined,
): FormAnswerRow[] {
  if (!answers || Object.keys(answers).length === 0) return [];

  const rows: FormAnswerRow[] = [];
  const fieldMap = new Map((fields ?? []).map((field) => [field.key, field]));
  const seen = new Set<string>();

  for (const field of fields ?? []) {
    if (!(field.key in answers)) continue;
    const rawValue = answers[field.key];
    const formatted = formatFormAnswerValue(rawValue, field);
    rows.push({ key: field.key, label: field.label, values: formatted, kind: answerKind(rawValue, formatted) });
    seen.add(field.key);
  }

  for (const key of Object.keys(answers).sort()) {
    if (seen.has(key)) continue;
    const rawValue = answers[key];
    const field = fieldMap.get(key);
    const formatted = formatFormAnswerValue(rawValue, field);
    rows.push({ key, label: field?.label ?? key, values: formatted, kind: answerKind(rawValue, formatted) });
  }

  return rows;
}
