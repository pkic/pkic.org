// @vitest-environment jsdom
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import {
  parseQueryContext,
  clearReferralSession,
  clearRememberedInvitation,
  clearRememberedInvitations,
  signInReturnPath,
} from "../../assets/ts/shared/query-context";

describe("query context", () => {
  beforeEach(() => {
    // Prevent referral and remembered-invitation state leaking between tests
    clearReferralSession();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
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

  it("keeps the invitation token out of a sign-in return path and finds it again by invitation id", () => {
    // The portal's sign-in screen sees the route before any page has read it, so the path alone keeps the token.
    const returnPath = signInReturnPath("/events/toronto-2027/register?invite=secret-token&id=inv-1&source=invite");
    expect(returnPath).toBe("/events/toronto-2027/register?id=inv-1&source=invite");
    expect(returnPath).not.toContain("secret-token");

    expect(parseQueryContext("?id=inv-1&source=invite").inviteToken).toBe("secret-token");
    expect(parseQueryContext("?id=inv-2").inviteToken).toBeNull();
  });

  it("keeps a token without an invitation id out of the return path too, though it cannot be found again", () => {
    // Every emailed invitation carries its id; a hand-made link without one loses the invitation rather than leak it.
    expect(signInReturnPath("/events/toronto-2027/register?invite=secret-token")).toBe("/events/toronto-2027/register");
    expect(localStorage.length).toBe(0);
  });

  it("forgets a remembered invitation after a day, and any old entry the next time one is kept", () => {
    vi.useFakeTimers({ now: new Date("2026-11-18T09:00:00.000Z"), toFake: ["Date"] });
    signInReturnPath("/events/toronto-2027/register?invite=old-token&id=inv-old");
    localStorage.setItem("pkic_invite:inv-legacy", "bare-token");
    vi.setSystemTime(new Date("2026-11-19T09:00:00.001Z"));

    signInReturnPath("/events/toronto-2027/register?invite=new-token&id=inv-new");
    expect(localStorage.getItem("pkic_invite:inv-old")).toBeNull();
    expect(localStorage.getItem("pkic_invite:inv-legacy")).toBeNull();
    expect(parseQueryContext("?id=inv-old").inviteToken).toBeNull();
    expect(parseQueryContext("?id=inv-new").inviteToken).toBe("new-token");
  });

  it("keeps the first token for an invitation, so a later link cannot swap it", () => {
    signInReturnPath("/events/toronto-2027/register?invite=first-token&id=inv-1");
    // A link someone else made for the same invitation is used on that page only and never replaces what is kept.
    expect(parseQueryContext("?id=inv-1&invite=other-token").inviteToken).toBe("other-token");
    expect(signInReturnPath("/events/toronto-2027/register?invite=other-token&id=inv-1")).toBe(
      "/events/toronto-2027/register?id=inv-1",
    );
    expect(parseQueryContext("?id=inv-1").inviteToken).toBe("first-token");
  });

  it("forgets every remembered invitation on sign-out and nothing else", () => {
    signInReturnPath("/events/toronto-2027/register?invite=token-1&id=inv-1");
    signInReturnPath("/events/toronto-2027/propose?invite=token-2&id=inv-2");
    localStorage.setItem("unrelated", "kept");
    clearRememberedInvitations();
    expect(parseQueryContext("?id=inv-1").inviteToken).toBeNull();
    expect(parseQueryContext("?id=inv-2").inviteToken).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("kept");
  });

  it("forgets a remembered invitation once it is cleared", () => {
    signInReturnPath("/events/toronto-2027/register?invite=secret-token&id=inv-1");
    clearRememberedInvitation("inv-1");
    expect(parseQueryContext("?id=inv-1").inviteToken).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
