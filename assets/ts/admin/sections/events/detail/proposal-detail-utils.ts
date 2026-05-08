import type { AdminFormDetailField } from "../../../types";

export interface ProposalAnswerRow {
  key: string;
  label: string;
  values: string[];
  kind: "text" | "list" | "pre";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionLabelMap(options: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (!Array.isArray(options)) {
    return labels;
  }

  for (const entry of options) {
    if (typeof entry === "string") {
      labels.set(entry, entry);
      continue;
    }
    if (isRecord(entry) && typeof entry.value === "string") {
      labels.set(
        entry.value,
        typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : entry.value,
      );
    }
  }

  return labels;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : "—";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value == null) {
    return "—";
  }
  return JSON.stringify(value, null, 2);
}

export function formatProposalAnswerValue(value: unknown, field?: AdminFormDetailField): ProposalAnswerRow["values"] {
  const labels = optionLabelMap(field?.options);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return ["—"];
    }

    return value.map((entry) => {
      if (typeof entry === "string") {
        return labels.get(entry) ?? entry;
      }
      return stringifyUnknown(entry);
    });
  }

  if (typeof value === "string") {
    return [labels.get(value) ?? stringifyUnknown(value)];
  }

  return [stringifyUnknown(value)];
}

function answerKind(value: unknown, formatted: string[]): ProposalAnswerRow["kind"] {
  if (Array.isArray(value) && formatted.length > 1) {
    return "list";
  }
  if ((isRecord(value) || (Array.isArray(value) && formatted.length === 1)) && formatted[0] !== "—") {
    return "pre";
  }
  if (formatted.some((entry) => entry.includes("\n"))) {
    return "pre";
  }
  return "text";
}

export function buildProposalAnswerRows(
  answers: Record<string, unknown> | null | undefined,
  fields: AdminFormDetailField[] | null | undefined,
): ProposalAnswerRow[] {
  if (!answers || Object.keys(answers).length === 0) {
    return [];
  }

  const rows: ProposalAnswerRow[] = [];
  const fieldMap = new Map((fields ?? []).map((field) => [field.key, field]));
  const seen = new Set<string>();

  for (const field of fields ?? []) {
    if (!(field.key in answers)) {
      continue;
    }
    const rawValue = answers[field.key];
    const formatted = formatProposalAnswerValue(rawValue, field);
    rows.push({
      key: field.key,
      label: field.label,
      values: formatted,
      kind: answerKind(rawValue, formatted),
    });
    seen.add(field.key);
  }

  for (const key of Object.keys(answers).sort()) {
    if (seen.has(key)) {
      continue;
    }
    const rawValue = answers[key];
    const field = fieldMap.get(key);
    const formatted = formatProposalAnswerValue(rawValue, field);
    rows.push({
      key,
      label: field?.label ?? key,
      values: formatted,
      kind: answerKind(rawValue, formatted),
    });
  }

  return rows;
}
