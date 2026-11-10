import { describe, expect, it } from "vitest";
import { createModelLevelContent } from "../../site/model-level-content";
import { readableModelSchema } from "../../site/model-version-source";

const model = (overrides: Record<string, unknown> = {}) => ({
  model: { id: "pqcmm", version: "1.1.0" },
  scoring: { rule: "Levels are cumulative" },
  levels: [
    {
      number: 0,
      name: "None",
      title: "Level 0",
      description: "No PQC",
      summary: "Baseline",
      sourcePage: "/wg/pqc/pqcmm/levels/0-none/",
      criteria: {
        introduction: "A product is at Level 0 when:",
        items: [{ id: "0.1.1", text: "No algorithm is available.", assessmentQuestionIds: ["0.2.1"] }],
      },
      assessment: {
        methodology: "",
        groups: [
          {
            id: "0.2",
            name: "Supplier Intake Questions",
            kind: "intake",
            introduction: "These are planning inputs.",
            questions: [{ id: "0.2.1", question: "When?", expectedInput: "Date", purpose: "Milestone" }],
          },
        ],
      },
      evidenceChecklist: { introduction: "", items: [] },
      sections: [{ title: "Taxonomy", body: "- Data in transit" }],
      ...overrides,
    },
  ],
});
const parsed = (overrides?: Record<string, unknown>) => readableModelSchema.parse(model(overrides));
const content = (overrides?: Record<string, unknown>) => {
  const value = parsed(overrides);
  return createModelLevelContent(value, value.levels[0]!);
};
const call = (props: Record<string, string>, inner?: string) => ({ positional: [], props, inner });

describe("model level content placed in authored pages", () => {
  it("keeps intake inputs, purposes and criterion links that the page renders", () => {
    const levelContent = content();
    const criteria = levelContent.render(call({ part: "criteria" }));
    expect(criteria).toMatch(/^\{\{< requirements >\}\}/);
    expect(criteria).toContain("A product is at Level 0 when:");
    expect(criteria).toContain("Assessed by Supplier Intake Questions [0.2.1](#0.2.1)");
    expect(criteria).not.toContain("includes:");
    const intake = levelContent.render(call({ part: "questions", group: "0.2" }));
    expect(intake).not.toContain("### Supplier Intake Questions");
    expect(intake).toContain("These are planning inputs.");
    expect(intake).toContain("Expected input");
    expect(intake).toContain("Milestone");
  });

  it("reports model content the page does not place and rejects placing it twice", () => {
    const levelContent = content();
    levelContent.render(call({ part: "criteria" }));
    expect(levelContent.unplaced()).toEqual(["question group 0.2", 'section "Taxonomy"']);
    expect(() => levelContent.render(call({ part: "criteria" }))).toThrow(/placed more than once/);
    expect(() => levelContent.render(call({ part: "summary" }))).toThrow(/Unknown model part/);
  });

  it("uses an authored fallback until a model version carries the section", () => {
    const withSection = content();
    expect(withSection.render(call({ part: "section", title: "Taxonomy" }, "Fallback"))).toBe("- Data in transit");
    const withoutSection = content({ sections: [] });
    expect(withoutSection.render(call({ part: "section", title: "Taxonomy" }, "\nFallback\n"))).toBe("Fallback");
  });

  it("fails when a version lacks a section the page places, unless the placement is optional", () => {
    const withoutSection = content({ sections: [] });
    expect(() => withoutSection.render(call({ part: "section", title: "Taxonomy" }))).toThrow(
      /has no section "Taxonomy"/,
    );
    expect(withoutSection.render(call({ part: "section", title: "Taxonomy", optional: "true" }))).toBe("");
  });

  it.each([
    ["<script>alert(1)</script>", /raw HTML/],
    ['<img src="x" onerror="alert(1)">', /raw HTML/],
    ["[Unsafe](javascript:alert%281%29)", /script-capable/],
    ["[Unsafe][ref]\n\n[ref]: javascript:alert(1)", /script-capable/],
    ["[Unsafe](java&#115;cript:alert(1))", /script-capable/],
    ["[Unsafe](javascript&#58;alert(1))", /script-capable/],
    ["![Unsafe](data:text/html;base64,PHNjcmlwdD4=)", /script-capable/],
  ])("fails closed on model text %s instead of rewriting it", (text, message) => {
    const value = model();
    value.levels[0]!.criteria.items[0]!.text = text;
    expect(() => readableModelSchema.parse(value)).toThrow(message);
  });

  it("accepts relative, anchor, web and mail links in model text", () => {
    const value = model();
    value.levels[0]!.criteria.items[0]!.text =
      "See [Level 1](/wg/pqc/pqcmm/levels/1-initial/), [question 1](#1.2.1), [NIST](https://csrc.nist.gov/?a=1&b=2) and [us](mailto:pqc@pkic.org).";
    expect(() => readableModelSchema.parse(value)).not.toThrow();
  });
});
