import { describe, expect, it } from "vitest";
import { formAnswersContract } from "../assets/shared/schemas/form-answer-contract";

const text = { key: "reason", label: "Reason", fieldType: "text" as const, required: false, validation: null };
const choice = {
  key: "track",
  label: "Track",
  fieldType: "select" as const,
  required: true,
  options: [{ value: "a", label: "A", active: true }],
};
const remote = { ...text, key: "remote_note", validation: { showWhen: { dayAttendanceIn: ["remote"] } } };

describe("the answer contract generated from form fields", () => {
  it("keeps only the answers given, each in the shape its field stores", () => {
    expect(formAnswersContract([text]).parse({})).toEqual({});
    expect(formAnswersContract([text, choice]).parse({ reason: "  Because ", track: "a", other: "x" })).toEqual({
      reason: "Because",
      track: "a",
    });
  });

  it("refuses each answer under its own field key, in the answer rules' words", () => {
    const refused = formAnswersContract([text, choice]).safeParse({ track: "z" });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["track", "Track must be one of the configured options"],
    ]);
  });

  it("does not ask a question its visibility rules hide", () => {
    expect(formAnswersContract([remote]).parse({ remote_note: "hello" })).toEqual({});
    expect(formAnswersContract([remote], { dayAttendanceTypes: ["remote"] }).parse({ remote_note: "hello" })).toEqual({
      remote_note: "hello",
    });
  });
});
