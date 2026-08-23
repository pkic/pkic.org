import { describe, expect, it } from "vitest";
import {
  hasUrlHostname,
  httpCapabilityUrlSchema,
  httpOrSameOriginUrlSchema,
  httpUrlSchema,
  normalizeHttpOrSameOriginUrl,
  sanitizeLegacyHttpUrl,
  sameOriginPathSchema,
} from "../assets/shared/schemas/urls";
import { applicationEditableAnswersSchema } from "../assets/shared/schemas/admin-applications";
import { donationPromoterResponseSchema } from "../assets/shared/schemas/donation";
import { proposalCreateResponseSchema } from "../assets/shared/schemas/proposal-management";
import { registrationConfirmResponseSchema } from "../assets/shared/schemas/registration";

describe("canonical URL contracts", () => {
  it("accepts only bounded HTTP(S) URLs without credentials", () => {
    expect(httpUrlSchema.parse(" https://example.com/path ")).toBe("https://example.com/path");
    for (const value of ["javascript:alert(1)", "ftp://example.com/file", "https://user:pass@example.com/"]) {
      expect(httpUrlSchema.safeParse(value).success).toBe(false);
    }
  });

  it("allows longer generated capability links without relaxing user-supplied URLs", () => {
    const signedUrl = `https://example.com/manage?token=${"a".repeat(900)}`;
    expect(httpUrlSchema.safeParse(signedUrl).success).toBe(false);
    expect(httpCapabilityUrlSchema.parse(signedUrl)).toBe(signedUrl);
    expect(httpCapabilityUrlSchema.safeParse(`https://example.com/manage?token=${"a".repeat(5000)}`).success).toBe(
      false,
    );
    expect(httpCapabilityUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
  });

  it("keeps same-origin paths separate from scheme-relative and backslash paths", () => {
    expect(sameOriginPathSchema.parse("/events/example/hero.png?v=1")).toBe("/events/example/hero.png?v=1");
    expect(sameOriginPathSchema.safeParse("//evil.test/image.png").success).toBe(false);
    expect(sameOriginPathSchema.safeParse("/safe\\evil").success).toBe(false);
    expect(httpOrSameOriginUrlSchema.safeParse("data:image/svg+xml,evil").success).toBe(false);
  });

  it("normalizes same-site and local-development assets but preserves external HTTP(S) URLs", () => {
    expect(normalizeHttpOrSameOriginUrl("https://preview.pkic.org/hero.png?v=1", "https://preview.pkic.org")).toBe(
      "/hero.png?v=1",
    );
    expect(normalizeHttpOrSameOriginUrl("http://localhost:8788/hero.png", "https://preview.pkic.org")).toBe(
      "/hero.png",
    );
    expect(normalizeHttpOrSameOriginUrl("https://cdn.example.test/hero.png", "https://preview.pkic.org")).toBe(
      "https://cdn.example.test/hero.png",
    );
  });

  it("sanitizes invalid legacy URLs and compares parsed hostname boundaries", () => {
    expect(sanitizeLegacyHttpUrl("not-a-url")).toBeNull();
    expect(sanitizeLegacyHttpUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(hasUrlHostname("https://sub.example.com/path", "example.com")).toBe(true);
    expect(hasUrlHostname("https://notexample.com/path", "example.com")).toBe(false);
  });

  it("reuses the HTTP-only primitive across persisted and navigable contracts", () => {
    expect(
      applicationEditableAnswersSchema.safeParse({ linkedin: "javascript:alert(1)", organization_website: null })
        .success,
    ).toBe(false);
    expect(
      applicationEditableAnswersSchema.safeParse({
        linkedin: "https://linkedin.com/in/example",
        organization_website: "https://example.com",
      }).success,
    ).toBe(true);

    for (const schema of [
      donationPromoterResponseSchema.shape.shareUrl,
      donationPromoterResponseSchema.shape.ogImageUrl,
      proposalCreateResponseSchema.shape.manageUrl,
      proposalCreateResponseSchema.shape.shareUrl,
      registrationConfirmResponseSchema.shape.manageUrl,
    ]) {
      expect(schema.safeParse("javascript:alert(1)").success).toBe(false);
      expect(schema.safeParse("https://example.com/path").success).toBe(true);
    }
  });
});
