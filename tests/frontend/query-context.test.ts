// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { parseQueryContext, clearReferralSession } from "../../assets/ts/shared/query-context";

describe("query context", () => {
  beforeEach(() => {
    // Prevent sessionStorage referral state leaking between tests
    clearReferralSession();
  });

  it("parses invite, referral, source and event values", () => {
    const parsed = parseQueryContext("?event=pqc-2026&invite=abc123&ref=code77&source=campaign&token=t-1");

    expect(parsed.eventSlug).toBe("pqc-2026");
    expect(parsed.inviteToken).toBe("abc123");
    expect(parsed.referralCode).toBe("code77");
    expect(parsed.sourceType).toBe("campaign");
    expect(parsed.token).toBe("t-1");
  });

  it("normalizes empty params to null", () => {
    const parsed = parseQueryContext("?event=&invite= ");

    expect(parsed.eventSlug).toBeNull();
    expect(parsed.inviteToken).toBeNull();
    expect(parsed.referralCode).toBeNull();
    expect(parsed.sourceType).toBeNull();
    expect(parsed.token).toBeNull();
  });

  it("falls back to sessionStorage when ?ref= is absent", () => {
    // First call: URL contains the ref — stores it in sessionStorage
    parseQueryContext("?event=pqc-2026&ref=abc123");

    // Second call: navigate away — URL no longer contains ref
    const later = parseQueryContext("?event=pqc-2026");
    expect(later.referralCode).toBe("abc123");
  });

  it("clears sessionStorage after clearReferralSession() is called", () => {
    parseQueryContext("?ref=xyz789");
    clearReferralSession();
    const after = parseQueryContext("?event=pqc-2026");
    expect(after.referralCode).toBeNull();
  });
});
