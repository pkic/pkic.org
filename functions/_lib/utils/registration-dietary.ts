import type { FormFieldDefinition } from "../services/forms";

const DIETARY_FIELD_FALLBACK_KEYS = ["dietary_restrictions", "dietary"];
const DIETARY_FIELD_PATTERN = /dietary/i;

function normalizeDietaryValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}

export function getDietaryFieldKeys(formFields: FormFieldDefinition[] | null | undefined): string[] {
  const matchedKeys =
    formFields
      ?.filter(
        (field) =>
          field.fieldType !== "boolean" &&
          (DIETARY_FIELD_PATTERN.test(field.key) || DIETARY_FIELD_PATTERN.test(field.label)),
      )
      .map((field) => field.key) ?? [];

  return [...new Set([...matchedKeys, ...DIETARY_FIELD_FALLBACK_KEYS])];
}

export function extractDietarySelections(
  customAnswers: Record<string, unknown> | null | undefined,
  formFields: FormFieldDefinition[] | null | undefined,
): string[] {
  if (!customAnswers) return [];

  const dietarySelections = new Set<string>();
  for (const key of getDietaryFieldKeys(formFields)) {
    for (const item of normalizeDietaryValue(customAnswers[key])) {
      dietarySelections.add(item);
    }
  }

  return [...dietarySelections];
}
