import { describe, expect, it } from "vitest";
import {
  portalHashPath,
  portalIdentityInvitationToken,
  portalMagicLinkReturnPath,
  portalMagicLinkToken,
  portalReturnPath,
} from "../../assets/ts/member-flows/portal/hash-route";
import { userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";
import { signInReturnHref, siteFlowReturnPath } from "../../assets/shared/sign-in-purpose";

describe("portal return path", () => {
  it("names a deep link as the route to come back to, but not the portal's own entry points", () => {
    expect(portalReturnPath("#/groups/cm")).toBe("/groups/cm");
    expect(portalReturnPath("#/groups/cm/members?tab=all")).toBe("/groups/cm/members?tab=all");
    expect(portalReturnPath("#/")).toBeUndefined();
    expect(portalReturnPath("")).toBeUndefined();
    expect(portalReturnPath("#/login")).toBeUndefined();
    expect(portalReturnPath("#/verify?token=abc")).toBeUndefined();
    expect(portalReturnPath("#/auth/oauth?client_id=x")).toBeUndefined();
    expect(portalReturnPath("#/identity-invitations?token=secret-token")).toBeUndefined();
  });

  it("preserves only the short authorization reference through canonical email login", () => {
    const path = "/auth/oauth?request=00000000-0000-4000-8000-000000000001";
    expect(portalReturnPath(`#${path}&token=untrusted&return_to=https://evil.example`)).toBe(path);
    expect(userAuthRequestSchema.safeParse({ email: "a@b.test", returnPath: path }).success).toBe(true);
    expect(portalMagicLinkReturnPath(`#/verify?token=synthetic&next=${encodeURIComponent(path)}`)).toBe(path);
    expect(portalReturnPath("#/auth/oauth?request=invalid")).toBeUndefined();
  });

  it("reads a public identity invitation token without treating it as a login link", () => {
    const hash = "#/identity-invitations?token=secret-token";
    expect(portalHashPath(hash)).toBe("/identity-invitations");
    expect(portalIdentityInvitationToken(hash)).toBe("secret-token");
    expect(portalMagicLinkToken(hash)).toBeNull();
  });

  it("reads the token and the return path off a verify link", () => {
    const hash = "#/verify?next=%2Fgroups%2Fcm&token=secret-token";
    expect(portalHashPath(hash)).toBe("/verify");
    expect(portalMagicLinkToken(hash)).toBe("secret-token");
    expect(portalMagicLinkReturnPath(hash)).toBe("/groups/cm");
    expect(portalMagicLinkReturnPath("#/verify?token=secret-token")).toBeNull();
    expect(portalMagicLinkReturnPath("#/groups/cm")).toBeNull();
  });

  it("refuses a return path that could leave the portal", () => {
    expect(portalMagicLinkReturnPath("#/verify?next=https%3A%2F%2Fevil.example&token=t")).toBeNull();
    expect(portalMagicLinkReturnPath("#/verify?next=%2F%2Fevil.example&token=t")).toBeNull();
    expect(portalReturnPath("#//evil.example")).toBeUndefined();
    expect(userAuthRequestSchema.safeParse({ email: "a@b.test", returnPath: "https://evil.example" }).success).toBe(
      false,
    );
    expect(userAuthRequestSchema.safeParse({ email: "a@b.test", returnPath: "/groups/cm" }).success).toBe(true);
    expect(userAuthRequestSchema.safeParse({ email: "a@b.test" }).success).toBe(true);
  });

  it("returns a sign-in begun on a public event form to that form, and nowhere else outside the portal", () => {
    const next = portalMagicLinkReturnPath("#/verify?next=%2Fevents%2F2026%2Fpqc%2Fregister%2F%3Fref%3Dx&token=t");
    expect(next).toBe("/events/2026/pqc/register/?ref=x");
    expect(siteFlowReturnPath(next)).toBe("/events/2026/pqc/register/?ref=x");
    expect(siteFlowReturnPath("/events/2026/pqc/")).toBeNull();
    expect(siteFlowReturnPath("/groups/cm")).toBeNull();
    expect(siteFlowReturnPath(null)).toBeNull();
  });

  it("keeps a portal event route in the portal, though it looks like a yearless event page", () => {
    const next = portalMagicLinkReturnPath(
      "#/verify?next=%2Fevents%2Fpqc%2Fregister%3Fid%3Dinv-1%26source%3Dinvite_resend&token=t",
    );
    expect(next).toBe("/events/pqc/register?id=inv-1&source=invite_resend");
    expect(siteFlowReturnPath(next)).toBeNull();
    expect(signInReturnHref(next ?? undefined)).toBe("/portal/#/events/pqc/register?id=inv-1&source=invite_resend");
    expect(signInReturnHref("/events/2026/pqc/register/?ref=x")).toBe("/events/2026/pqc/register/?ref=x");
    expect(signInReturnHref(undefined)).toBe("/portal/");
  });
});
