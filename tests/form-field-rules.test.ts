import { describe, expect, it } from "vitest";
import {
  formFieldOptionValues,
  isAllowedProfileUrl,
  isFormFieldVisible,
  parseFormFieldOptions,
  parseFormFieldRules,
} from "../assets/shared/schemas/form-field-rules";

describe("canonical form-field rules", () => {
  it("normalizes the one persisted rule shape used by frontend and backend", () => {
    expect(
      parseFormFieldRules({
        format: "professional_profile",
        maxLength: 200,
        allowedDomains: ["example.com", 42],
        showWhen: { dayAttendanceIn: ["in_person", null], eventAttendanceTypeIn: ["virtual", "invalid"] },
        ignored: true,
      }),
    ).toEqual({
      format: "professional_profile",
      maxLength: 200,
      allowedDomains: ["example.com"],
      showWhen: { dayAttendanceIn: ["in_person"], eventAttendanceTypeIn: ["virtual"] },
    });
  });

  it("uses one visibility policy on both runtime sides", () => {
    const rules = parseFormFieldRules({ showWhen: { dayAttendanceIn: ["in_person"] } });
    expect(isFormFieldVisible(rules, { dayAttendanceTypes: ["in_person"] })).toBe(true);
    expect(isFormFieldVisible(rules, { dayAttendanceTypes: ["virtual"] })).toBe(false);
  });

  it("uses one tolerant option codec", () => {
    const raw = ["one", { value: "two", label: " Second " }, { ignored: true }];
    expect(parseFormFieldOptions(raw)).toEqual([
      { value: "one", label: "one" },
      { value: "two", label: "Second" },
    ]);
    expect(formFieldOptionValues(raw)).toEqual(["one", "two"]);
  });

  it("allows only HTTP profile URLs on configured domains or subdomains", () => {
    expect(isAllowedProfileUrl("https://www.linkedin.com/in/alice")).toBe(true);
    expect(isAllowedProfileUrl("https://profile.example.com/alice", ["example.com"])).toBe(true);
    expect(isAllowedProfileUrl("https://notexample.com/alice", ["example.com"])).toBe(false);
    expect(isAllowedProfileUrl("javascript:alert(1)", ["example.com"])).toBe(false);
  });
});
