/**
 * An email address has one stored spelling: trimmed, lower case, and with an
 * internationalized domain in its ASCII (punycode) form.
 */
import { describe, expect, it } from "vitest";
import { asciiEmailDomain, normalizeEmailAddress } from "../assets/shared/email-address";
import { normalizedEmailSchema } from "../assets/shared/schemas/api-common";
import { normalizeEmail } from "../functions/_lib/validation";

describe("email address normalization", () => {
  it.each([
    ["Name@Example.com", "name@example.com"],
    ["  name@example.com  ", "name@example.com"],
    ["jose@bücher.example", "jose@xn--bcher-kva.example"],
    ["Jose@BÜCHER.example", "jose@xn--bcher-kva.example"],
    ["info@例え.テスト", "info@xn--r8jz45g.xn--zckzah"],
    ["already@xn--bcher-kva.example", "already@xn--bcher-kva.example"],
  ])("stores %s as %s, in the contract and in the Worker alike", (typed, stored) => {
    expect(normalizedEmailSchema.parse(typed)).toBe(stored);
    expect(normalizeEmail(typed)).toBe(stored);
    expect(normalizeEmailAddress(typed)).toBe(stored);
  });

  it.each(["", "not-an-address", "name@", "@example.com", "name@exa mple.com", "name@bücher/evil.example"])(
    "refuses %j with the shared message",
    (typed) => {
      const parsed = normalizedEmailSchema.safeParse(typed);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(
        "Please enter a valid email address (for example: name@example.com).",
      );
    },
  );

  it("refuses a value that is not text with the same message", () => {
    expect(normalizedEmailSchema.safeParse(42).error?.issues[0]?.message).toBe(
      "Please enter a valid email address (for example: name@example.com).",
    );
  });

  it("leaves the local part and anything not shaped like an address alone", () => {
    expect(asciiEmailDomain("Ünïcode@example.com")).toBe("Ünïcode@example.com");
    expect(asciiEmailDomain("no-at-sign")).toBe("no-at-sign");
  });
});
