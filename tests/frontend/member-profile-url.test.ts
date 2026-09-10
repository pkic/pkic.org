/**
 * Where a member's public page lives.
 *
 * Issue #15 asked for a readable address; the reason it kept coming back is
 * that three surfaces each answered the question separately. These tests pin
 * the one answer, including the branch — an individual with no organization
 * row — that nothing previously covered.
 */
import { describe, expect, it } from "vitest";
import { MEMBER_PROFILE_SHELL_PATH, memberProfileHref } from "../../assets/shared/member-profile-url";

describe("memberProfileHref", () => {
  it("gives an organization the readable address its Hugo page had", () => {
    // The exact shape members link to from their own sites and search engines
    // have indexed, so nothing outside this repository has to change.
    expect(memberProfileHref({ id: "efeb58e2-1b8f-43fa-9464-e84f6d536305", slug: "keyfactor" })).toBe(
      "/members/keyfactor/",
    );
  });

  it("falls back to the id-keyed shell only when there is no slug to use", () => {
    // An individual member has no organizations row, so nothing holds a slug.
    expect(memberProfileHref({ id: "49e927b2-1163-4efb-b1b3-c5bd7971b685", slug: null })).toBe(
      `${MEMBER_PROFILE_SHELL_PATH}?id=49e927b2-1163-4efb-b1b3-c5bd7971b685`,
    );
    expect(memberProfileHref({ id: "49e927b2" })).toBe(`${MEMBER_PROFILE_SHELL_PATH}?id=49e927b2`);
    // An empty slug is no slug, not a link to `/members//`.
    expect(memberProfileHref({ id: "x", slug: "" })).toBe(`${MEMBER_PROFILE_SHELL_PATH}?id=x`);
  });

  it("escapes what it puts in the address", () => {
    expect(memberProfileHref({ id: "a b/c", slug: null })).toBe(`${MEMBER_PROFILE_SHELL_PATH}?id=a%20b%2Fc`);
    expect(memberProfileHref({ id: "x", slug: "a b" })).toBe("/members/a%20b/");
  });
});
