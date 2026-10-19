import { z } from "zod";
import {
  formAnswerProblems,
  isEmptyFormAnswer,
  normalizeFormAnswer,
  type AnswerableFormField,
  type CustomAnswerValue,
} from "../form-answer-rules";
import { isFormFieldVisible, parseFormFieldRules, type FormFieldVisibilityContext } from "./form-field-rules";

/** A field as its answer contract reads it: the answer rules' view plus its rules JSON. */
export interface ContractFormField extends AnswerableFormField {
  validation?: unknown;
}

/**
 * The request contract for answers to a set of form fields, generated from
 * their definitions: one entry per question the respondent is asked, judged by
 * the shared answer rules. Every respondent surface — a form, a live poll —
 * validates its answers through this one contract, and the server reads a
 * submission through it, so a question refuses the same answer, with the same
 * words, on either side. Issues are keyed by the field key.
 *
 * A question hidden by its visibility rules for `context` is not asked, so it
 * is neither required nor kept. The output holds only the answers given, each
 * in the shape its field stores.
 */
export function formAnswersContract(
  fields: readonly ContractFormField[],
  context: FormFieldVisibilityContext = {},
): z.ZodType<Record<string, CustomAnswerValue>> {
  const shape: Record<string, z.ZodType<CustomAnswerValue | null>> = {};
  for (const field of fields) {
    const rules = parseFormFieldRules(field.validation);
    if (!isFormFieldVisible(rules, context)) continue;
    shape[field.key] = z
      .unknown()
      .optional()
      .transform((value, issue) => {
        const normalized = normalizeFormAnswer(field, value, rules);
        for (const message of formAnswerProblems(field, normalized, rules)) issue.addIssue({ code: "custom", message });
        // An unanswered question is null here and left out of the answers below.
        return isEmptyFormAnswer(normalized) ? null : (normalized as CustomAnswerValue);
      });
  }
  return z
    .object(shape)
    .transform(
      (answers) =>
        Object.fromEntries(Object.entries(answers).filter(([, value]) => value !== null)) as Record<
          string,
          CustomAnswerValue
        >,
    );
}
