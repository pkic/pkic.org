import { describe, expect, it } from "vitest";
import { eventEmailCampaignPreviewInputSchema } from "../assets/shared/schemas/event-email-campaigns";
import {
  formFieldRulesSchema,
  formFieldOptionValues,
  isSafeFormFieldPattern,
  isAllowedProfileUrl,
  isFormFieldVisible,
  parseFormFieldOptions,
  parseFormFieldRules,
} from "../assets/shared/schemas/form-field-rules";
import {
  ATTENDANCE_TYPES as CANONICAL_ATTENDANCE_TYPES,
  attendanceTypeSchema as canonicalAttendanceTypeSchema,
} from "../assets/shared/schemas/registration";

describe("canonical form-field rules", () => {
  it("uses the canonical attendance vocabulary across registration, form rules, and campaigns", () => {
    expect(CANONICAL_ATTENDANCE_TYPES).toEqual(["in_person", "virtual", "on_demand"]);
    for (const attendanceType of CANONICAL_ATTENDANCE_TYPES) {
      expect(canonicalAttendanceTypeSchema.safeParse(attendanceType).success).toBe(true);
      expect(formFieldRulesSchema.safeParse({ showWhen: { eventAttendanceTypeIn: [attendanceType] } }).success).toBe(
        true,
      );
      expect(
        eventEmailCampaignPreviewInputSchema.safeParse({
          sendMode: "personal",
          filter: { audience: "attendees", attendanceType },
        }).success,
      ).toBe(true);
    }
    expect(canonicalAttendanceTypeSchema.safeParse("future_mode").success).toBe(false);
  });

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
      { value: "one", label: "one", active: true },
      { value: "two", label: "Second", active: true },
    ]);
    expect(formFieldOptionValues(raw)).toEqual(["one", "two"]);
  });

  it("allows only HTTP profile URLs on configured domains or subdomains", () => {
    expect(isAllowedProfileUrl("https://www.linkedin.com/in/alice")).toBe(true);
    expect(isAllowedProfileUrl("https://profile.example.com/alice", ["example.com"])).toBe(true);
    expect(isAllowedProfileUrl("https://notexample.com/alice", ["example.com"])).toBe(false);
    expect(isAllowedProfileUrl("javascript:alert(1)", ["example.com"])).toBe(false);
  });

  it("accepts only conservative, bounded custom patterns", () => {
    expect(isSafeFormFieldPattern("^[A-Za-z0-9_-]{1,80}$")).toBe(true);
    expect(isSafeFormFieldPattern("^\\+?[0-9() -]{7,25}$")).toBe(true);
    expect(isSafeFormFieldPattern("^(a+)+$")).toBe(false);
    expect(isSafeFormFieldPattern("^a+$")).toBe(false);
    expect(isSafeFormFieldPattern("^(?=a).*$")).toBe(false);
    expect(isSafeFormFieldPattern("^(a|aa)+$")).toBe(false);
    expect(isSafeFormFieldPattern("^a?b?c?$")).toBe(false);
  });

  it("bounds and cross-validates every configurable rule at the shared API boundary", () => {
    expect(formFieldRulesSchema.safeParse({ pattern: "^(a+)+$" }).success).toBe(false);
    expect(formFieldRulesSchema.safeParse({ maxLength: 100_001 }).success).toBe(false);
    expect(formFieldRulesSchema.safeParse({ minItems: 3, maxItems: 2 }).success).toBe(false);
    expect(formFieldRulesSchema.safeParse({ allowedDomains: Array(51).fill("example.com") }).success).toBe(false);
    expect(formFieldRulesSchema.safeParse({ unknownRule: true }).success).toBe(false);
  });

  it("drops unsafe legacy patterns before either the browser or backend can compile them", () => {
    expect(parseFormFieldRules({ pattern: "^(a+)+$", patternMessage: "Nope", maxLength: 200 })).toEqual({
      maxLength: 200,
    });
  });
});
