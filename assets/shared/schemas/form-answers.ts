import { z } from "zod";
import { databaseIdSchema } from "./identifiers";

/**
 * Resource limits shared by every API that accepts answers for a
 * portal-managed form. They are intentionally aligned with the admin form
 * contract (at most 50 fields) and keep one submission well below D1's
 * per-invocation query budget when answers are stored as normalized rows.
 */
export const MAX_FORM_ANSWER_FIELDS = 50;
export const MAX_FORM_ANSWER_KEY_LENGTH = 64;
export const MAX_FORM_ANSWER_STRING_LENGTH = 10_000;
export const MAX_FORM_ANSWER_ARRAY_LENGTH = 50;
export const MAX_FORM_ANSWERS_JSON_BYTES = 128 * 1024;

const formAnswerScalarSchema = z.union([
  z.string().trim().max(MAX_FORM_ANSWER_STRING_LENGTH),
  z.number().finite(),
  z.boolean(),
]);

const formAnswerDateRangeSchema = z
  .object({
    start: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .superRefine((value, context) => {
    if (value.start > value.end) {
      context.addIssue({
        code: "custom",
        message: "start must be less than or equal to end",
        path: ["start"],
      });
    }
  });

export const formAnswerValueSchema = z.union([
  formAnswerScalarSchema,
  z.array(formAnswerScalarSchema).max(MAX_FORM_ANSWER_ARRAY_LENGTH),
  formAnswerDateRangeSchema,
]);

export const formAnswersSchema = z
  .record(z.string().trim().min(1).max(MAX_FORM_ANSWER_KEY_LENGTH), formAnswerValueSchema)
  .superRefine((answers, context) => {
    if (Object.keys(answers).length > MAX_FORM_ANSWER_FIELDS) {
      context.addIssue({
        code: "too_big",
        maximum: MAX_FORM_ANSWER_FIELDS,
        origin: "object",
        inclusive: true,
        message: `At most ${MAX_FORM_ANSWER_FIELDS} form answers are allowed`,
      });
    }

    if (new TextEncoder().encode(JSON.stringify(answers)).byteLength > MAX_FORM_ANSWERS_JSON_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Form answers must not exceed ${MAX_FORM_ANSWERS_JSON_BYTES} encoded bytes`,
      });
    }
  });

export type FormAnswers = z.infer<typeof formAnswersSchema>;

export const formAnswerEntrySchema = z.object({
  fieldId: databaseIdSchema,
  value: formAnswerValueSchema,
});

/** Canonical stable-ID submission contract for all new form endpoints. */
export const formAnswerEntriesSchema = z
  .array(formAnswerEntrySchema)
  .max(MAX_FORM_ANSWER_FIELDS)
  .superRefine((answers, context) => {
    const seen = new Set<string>();
    for (const [index, answer] of answers.entries()) {
      if (seen.has(answer.fieldId)) {
        context.addIssue({ code: "custom", path: [index, "fieldId"], message: "Each field may be answered once" });
      }
      seen.add(answer.fieldId);
    }
    if (new TextEncoder().encode(JSON.stringify(answers)).byteLength > MAX_FORM_ANSWERS_JSON_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Form answers must not exceed ${MAX_FORM_ANSWERS_JSON_BYTES} encoded bytes`,
      });
    }
  });
export type FormAnswerEntry = z.infer<typeof formAnswerEntrySchema>;
