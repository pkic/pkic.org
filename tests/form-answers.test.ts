import { describe, expect, it } from "vitest";
import {
  formAnswersSchema,
  MAX_FORM_ANSWER_ARRAY_LENGTH,
  MAX_FORM_ANSWER_FIELDS,
  MAX_FORM_ANSWER_STRING_LENGTH,
  submittedFormAnswersSchema,
} from "../assets/shared/schemas/form-answers";
import { formDefinitionUpdateSchema } from "../assets/shared/schemas/forms";
import { membershipApplicationFormDefinitionUpdateSchema } from "../assets/shared/schemas/membership-application-form";

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

  it.each(["organization_name", "job_title"])("refuses %s as a submitted answer or a form question", (key) => {
    const answers = submittedFormAnswersSchema.safeParse({ [key]: "Typed value", dietary: "None" });
    expect(answers.success).toBe(false);
    expect(answers.error?.issues).toEqual([
      expect.objectContaining({ path: [key], message: expect.stringContaining("identity") }),
    ]);
    expect(submittedFormAnswersSchema.safeParse({ dietary: "None" }).success).toBe(true);
    const fields = [{ key, label: "Organization", fieldType: "text" }];
    const definition = formDefinitionUpdateSchema.safeParse({ fields });
    expect(definition.success).toBe(false);
    expect(definition.error?.issues).toEqual([expect.objectContaining({ path: ["fields", 0, "key"] })]);
    // The membership application asks for them: its answers create the applicant's identity.
    expect(
      membershipApplicationFormDefinitionUpdateSchema.safeParse({
        fields: [...fields, { key: "organization_website", label: "Organization website", fieldType: "url" }],
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

it.each([
  { fieldType: "text" },
  { validation: { format: "date_range" } },
  { validation: { showWhen: { dayAttendanceIn: ["remote"] } } },
])("refuses weakening the organization website question (%j)", (changes) => {
  const checked = membershipApplicationFormDefinitionUpdateSchema.safeParse({
    expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    fields: [{ key: "organization_website", label: "Organization website", fieldType: "url", ...changes }],
  });
  expect(checked.success).toBe(false);
  expect(checked.error?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["fields", 0] })]));
});
