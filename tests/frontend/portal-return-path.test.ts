import { describe, expect, it } from "vitest";
import {
  portalHashPath,
  portalMagicLinkReturnPath,
  portalMagicLinkToken,
  portalReturnPath,
} from "../../assets/ts/member-flows/portal/hash-route";
import { userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";

describe("portal return path", () => {
  it("names a deep link as the route to come back to, but not the portal's own entry points", () => {
    expect(portalReturnPath("#/groups/cm")).toBe("/groups/cm");
    expect(portalReturnPath("#/groups/cm/members?tab=all")).toBe("/groups/cm/members?tab=all");
    expect(portalReturnPath("#/")).toBeUndefined();
    expect(portalReturnPath("")).toBeUndefined();
    expect(portalReturnPath("#/login")).toBeUndefined();
    expect(portalReturnPath("#/verify?token=abc")).toBeUndefined();
    expect(portalReturnPath("#/auth/oauth?client_id=x")).toBeUndefined();
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
});
