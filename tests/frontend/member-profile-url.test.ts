// @vitest-environment jsdom
/**
 * Where a member's public page lives.
 *
 * Issue #15 asked for a readable address; the reason it kept coming back is
 * that three surfaces each answered the question separately. These tests pin
 * the one answer, including the branch — an individual with no organization
 * row — that nothing previously covered.
 */
import { describe, expect, it } from "vitest";
import { h, render } from "preact";
import { MemberDirectoryTabs } from "../../assets/ts/site/MemberDirectory";
import { memberProfileHref } from "../../assets/shared/member-profile-url";

describe("memberProfileHref", () => {
  it("gives an organization the readable address its Hugo page had", () => {
    // The exact shape members link to from their own sites and search engines
    // have indexed, so nothing outside this repository has to change.
    expect(memberProfileHref({ id: "efeb58e2-1b8f-43fa-9464-e84f6d536305", slug: "keyfactor" })).toBe(
      "/members/keyfactor/",
    );
  });

  it("gives independent members readable, stable addresses that distinguish namesakes", () => {
    const member = {
      id: "49e927b2-1163-4efb-b1b3-c5bd7971b685",
      name: "Taylor Example",
      memberType: "H6",
      slug: null,
    };
    const href = memberProfileHref(member);
    expect(href).toMatch(/^\/members\/independent\/taylor-example-[a-z0-9]+\/$/u);
    expect(href).toBe("/members/independent/taylor-example-efzbbdqkjjhw/");
    expect(href).not.toContain(member.id);
    expect(memberProfileHref({ ...member })).toBe(href);
    expect(memberProfileHref({ ...member, id: "49e927b2-1163-4efb-b1b3-c5bd7971b686" })).not.toBe(href);
    expect(memberProfileHref({ ...member, name: "Tàylor Éxample" })).toBe(href);
    for (const memberType of ["H5", "H6", "H7"]) expect(memberProfileHref({ ...member, memberType })).toBe(href);
  });

  it("escapes what it puts in the address", () => {
    expect(memberProfileHref({ id: "a b/c", slug: null })).toBe(`/members/a%20b%2Fc/`);
    expect(memberProfileHref({ id: "x", slug: "a b" })).toBe("/members/a%20b/");
  });
});

it("lets visitors browse either membership directory through real links", () => {
  const host = document.createElement("div");
  for (const active of ["organization", "independent"] as const) {
    render(h(MemberDirectoryTabs, { active }), host);
    const links = [...host.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/members/", "/members/independent/"]);
    expect(host.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
      active === "organization" ? "/members/" : "/members/independent/",
    );
  }
  render(null, host);
});
