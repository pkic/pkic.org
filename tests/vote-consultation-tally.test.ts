import { describe, expect, it } from "vitest";
import { computeConsultationResult, type ConsultationTallyQuestion } from "../functions/_lib/services/votes/tally";

/**
 * A consultation gathers preference across several questions; it does not
 * carry a motion. These cases fix that distinction, because the tempting
 * mistake is to give it an outcome and quietly turn a survey into a decision.
 */
const SUPPORT: ConsultationTallyQuestion = {
  fieldId: "field-support",
  key: "support",
  label: "Would you support this?",
  optionValues: ["yes", "no"],
  multiple: false,
};
const HOW: ConsultationTallyQuestion = {
  fieldId: "field-how",
  key: "how",
  label: "How should it be done?",
  optionValues: ["phased", "immediate"],
  multiple: false,
};
const CONCERNS: ConsultationTallyQuestion = {
  fieldId: "field-concerns",
  key: "concerns",
  label: "Which concerns apply?",
  optionValues: ["cost", "timing", "risk"],
  multiple: true,
};

describe("consultation tally", () => {
  it("answers the shape a consultation is actually for: yes, and how", () => {
    const result = computeConsultationResult(
      "form-1",
      [SUPPORT, HOW],
      [
        { support: "yes", how: "phased" },
        { support: "yes", how: "immediate" },
        { support: "no", how: "phased" },
      ],
    );
    expect(result.questions.map((question) => question.key)).toEqual(["support", "how"]);
    expect(result.questions[0].counts).toEqual({ yes: 2, no: 1 });
    expect(result.questions[1].counts).toEqual({ phased: 2, immediate: 1 });
    expect(result.totalResponses, "three people answered, not six").toBe(3);
  });

  it("reports a leader per question rather than an outcome for the whole vote", () => {
    const result = computeConsultationResult("form-1", [SUPPORT], [{ support: "yes" }, { support: "yes" }]);
    expect(result.questions[0].leadingOption).toBe("yes");
    expect(result).not.toHaveProperty("outcome");
  });

  it("names no leader when a question's top options tie", () => {
    const result = computeConsultationResult("form-1", [SUPPORT], [{ support: "yes" }, { support: "no" }]);
    // Declaring a winner on a tie would manufacture a preference nobody
    // expressed; a motion's tie rule does not apply to a survey.
    expect(result.questions[0].leadingOption).toBeNull();
  });

  it("counts a multi-select question once per person but once per choice", () => {
    const result = computeConsultationResult(
      "form-1",
      [CONCERNS],
      [{ concerns: ["cost", "risk"] }, { concerns: ["cost"] }],
    );
    expect(result.questions[0].counts).toEqual({ cost: 2, timing: 0, risk: 1 });
    expect(result.questions[0].answered, "two people answered, three choices were made").toBe(2);
  });

  it("does not count a question somebody skipped", () => {
    const result = computeConsultationResult(
      "form-1",
      [SUPPORT, HOW],
      [{ support: "yes" }, { support: "no", how: "phased" }],
    );
    expect(result.questions[0].answered).toBe(2);
    expect(result.questions[1].answered).toBe(1);
    expect(result.totalResponses, "a skipped question is still a response").toBe(2);
  });

  it("still reports an answer naming an option that has since been removed", () => {
    const result = computeConsultationResult("form-1", [SUPPORT], [{ support: "maybe" }, { support: "yes" }]);
    // The person did answer, and dropping it would change both the counts and
    // the participation without saying so.
    expect(result.questions[0].counts.maybe).toBe(1);
    expect(result.questions[0].answered).toBe(2);
  });

  it("applies a turnout floor to responses without inventing an outcome", () => {
    const result = computeConsultationResult("form-1", [SUPPORT], [{ support: "yes" }], {
      percent: 50,
      eligible: 10,
    });
    expect(result.quorum).toEqual({ percent: 50, eligible: 10, required: 5, met: false });
    expect(result.quorumMet).toBe(false);
    expect(result.questions[0].leadingOption, "a leader is still what the answers say").toBe("yes");
  });

  it("treats a consultation with no floor as always quorate", () => {
    const result = computeConsultationResult("form-1", [SUPPORT], [{ support: "yes" }]);
    expect(result.quorum).toBeNull();
    expect(result.quorumMet).toBe(true);
  });
});
