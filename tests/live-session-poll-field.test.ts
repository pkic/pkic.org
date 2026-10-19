import { describe, expect, it } from "vitest";
import { formFieldStatFromTallies } from "../assets/shared/form-field-statistics";
import { livePollFieldSchema, readLivePollAnswer } from "../assets/shared/schemas/live-session-poll";

const choice = { key: "answer", label: "Which first?", fieldType: "select", options: ["Root CA", "TLS"] };

describe("a live poll's question", () => {
  it("is a form field narrowed to answers that can be counted live, and always wants an answer", () => {
    expect(livePollFieldSchema.parse(choice).required).toBe(true);
    for (const refused of [
      { ...choice, options: ["Only one"] },
      { ...choice, options: undefined, optionSource: "active_working_groups" },
      { key: "score", label: "How many?", fieldType: "number" },
      { key: "score", label: "Rate", fieldType: "number", validation: { uiWidget: "rating_stars", min: 1, max: 20 } },
    ])
      expect(livePollFieldSchema.safeParse(refused).success, JSON.stringify(refused)).toBe(false);
    expect(
      livePollFieldSchema.safeParse({
        key: "nps",
        label: "Recommend?",
        fieldType: "number",
        validation: { uiWidget: "nps" },
      }).success,
    ).toBe(true);
  });

  it("accepts canonical bounded written answers for word clouds", () => {
    const field = livePollFieldSchema.parse({ key: "answer", label: "One word", fieldType: "text" });
    expect(field.validation?.maxLength).toBe(200);
    expect(readLivePollAnswer(field, "Trust").answer).toBe("Trust");
    expect(readLivePollAnswer(field, "x".repeat(201)).problem).not.toBeNull();
  });
  it("judges an answer by the forms answer rules", () => {
    const field = livePollFieldSchema.parse(choice);
    expect(readLivePollAnswer(field, "TLS")).toEqual({ answer: "TLS", problem: null });
    expect(readLivePollAnswer(field, "Quantum").problem).toMatch(/configured options/);
    expect(readLivePollAnswer(field, "").problem).toMatch(/required/);
    const rating = livePollFieldSchema.parse({
      key: "score",
      label: "Rate",
      fieldType: "number",
      validation: { uiWidget: "rating_stars" },
    });
    expect(readLivePollAnswer(rating, "4")).toEqual({ answer: 4, problem: null });
    expect(readLivePollAnswer(rating, 6).problem).toMatch(/score from 1 to 5/);
  });

  it("charts every offered answer from running tallies, in the author's order", () => {
    const field = livePollFieldSchema.parse({ ...choice, fieldType: "multi_select", options: ["A", "B", "C"] });
    const stat = formFieldStatFromTallies(
      field,
      new Map([
        ["C", 3],
        ["A", 1],
      ]),
      3,
    );
    expect(stat).toMatchObject({ fieldKey: "answer", totalAnswers: 3, uniqueAnswers: 2 });
    expect(stat.entries.map((entry) => [entry.label, entry.count, entry.percent])).toEqual([
      ["A", 1, 25],
      ["B", 0, 0],
      ["C", 3, 75],
    ]);
  });
});
