import type { FormFieldType } from "./schemas/forms";
import type { FormSubmissionStat } from "./schemas/form-management";
import { parseFormFieldOptions, parseFormFieldRules } from "./schemas/form-field-rules";
import { ratingScale } from "./form-answer-rules";

/**
 * How counted answers become one field's statistics: the entries every
 * results view draws, with each answer's share and its weight against the
 * most chosen one. Stored responses and a live poll's running tallies are
 * summarized by this one function, so a chart reads the same either way.
 */

export type FormFieldStatEntry = FormSubmissionStat["entries"][number];

/**
 * Entries from counts per answer label. `order: "count"` ranks the answers
 * (a report); `order: "given"` keeps the order they were passed in (a live
 * chart whose rows must not jump while votes arrive).
 */
export function formFieldStatEntries(
  counts: Iterable<readonly [label: string, count: number]>,
  order: "count" | "given" = "count",
): FormFieldStatEntry[] {
  const merged = new Map<string, number>();
  for (const [label, count] of counts) merged.set(label, (merged.get(label) ?? 0) + count);
  const maxCount = Math.max(1, ...merged.values());
  const countedValues = Array.from(merged.values()).reduce((sum, count) => sum + count, 0) || 1;
  const entries = Array.from(merged.entries()).map(([label, count]) => ({
    label,
    count,
    percent: Math.round((count / countedValues) * 100),
    weight: count / maxCount,
  }));
  if (order === "count") entries.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return entries;
}

/** What a field offers as answers, in the author's order, for counting before anyone answered. */
export interface TallyableFormField {
  key: string;
  fieldType: FormFieldType;
  options?: unknown;
  validation?: unknown;
}

/**
 * Every answer a closed question offers, as stored value and shown label: its
 * active choices, or each score of a rating. Empty for open questions.
 */
export function formFieldAnswerChoices(field: TallyableFormField): Array<{ value: string; label: string }> {
  if (field.fieldType === "select" || field.fieldType === "multi_select")
    return parseFormFieldOptions(field.options)
      .filter((option) => option.active)
      .map((option) => ({ value: option.value, label: option.label }));
  const scale = field.fieldType === "number" ? ratingScale(parseFormFieldRules(field.validation)) : null;
  if (!scale) return [];
  return Array.from({ length: Math.max(0, scale.max - scale.min + 1) }, (_, at) => String(scale.min + at)).map(
    (value) => ({
      value,
      label: value,
    }),
  );
}

/**
 * One field's statistics from running tallies per stored value: every
 * offered answer appears, chosen or not, in the author's order.
 */
export function formFieldStatFromTallies(
  field: TallyableFormField,
  tallies: ReadonlyMap<string, number>,
  respondents: number,
): FormSubmissionStat {
  const choices = formFieldAnswerChoices(field);
  const offered = new Set(choices.map((choice) => choice.value));
  const entries = formFieldStatEntries(
    [
      ...choices.map((choice) => [choice.label, tallies.get(choice.value) ?? 0] as const),
      ...[...tallies].filter(([value]) => !offered.has(value)),
    ],
    "given",
  );
  return {
    fieldKey: field.key,
    totalAnswers: respondents,
    uniqueAnswers: entries.filter((entry) => entry.count > 0).length,
    entries,
  };
}
