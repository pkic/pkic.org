import { describe, expect, it } from "vitest";
import {
  formAnswersSchema,
  MAX_FORM_ANSWER_ARRAY_LENGTH,
  MAX_FORM_ANSWER_FIELDS,
  MAX_FORM_ANSWER_STRING_LENGTH,
} from "../assets/shared/schemas/form-answers";

describe("shared portal-managed form answer contract", () => {
  it("accepts the canonical scalar, array, and date-range value shapes", () => {
    expect(
      formAnswersSchema.parse({
        text: "value",
        number: 7,
        accepted: true,
        selections: ["one", "two"],
        range: { start: "2026-08-20", end: "2026-08-21" },
      }),
    ).toBeTruthy();
  });

  it("rejects excessive field counts, individual values, arrays, and aggregate JSON size", () => {
    const tooManyFields = Object.fromEntries(
      Array.from({ length: MAX_FORM_ANSWER_FIELDS + 1 }, (_, index) => [`field_${index}`, "value"]),
    );
    expect(formAnswersSchema.safeParse(tooManyFields).success).toBe(false);
    expect(formAnswersSchema.safeParse({ value: "x".repeat(MAX_FORM_ANSWER_STRING_LENGTH + 1) }).success).toBe(false);
    expect(
      formAnswersSchema.safeParse({ values: Array.from({ length: MAX_FORM_ANSWER_ARRAY_LENGTH + 1 }, () => "x") })
        .success,
    ).toBe(false);

    const tooLarge = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`field_${index}`, "x".repeat(MAX_FORM_ANSWER_STRING_LENGTH)]),
    );
    expect(formAnswersSchema.safeParse(tooLarge).success).toBe(false);
  });
});
