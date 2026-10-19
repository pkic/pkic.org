// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("keeps the original member links keyboard-accessible and excludes decorative animation copies", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  document.body.innerHTML = `<section class="members-overview"><div class="members">
    <a href="/members/first/" data-sponsor-level="0" data-member-name="First">First</a>
    <a href="/members/second/" data-sponsor-level="5" data-member-name="Second">Second</a>
  </div></section>`;
  await import("../../assets/js/modules/sponsor-banner-marquee.js");
  await import("../../assets/js/modules/members-overview-effects.js");
  const original = document.querySelectorAll<HTMLAnchorElement>(".logo-wall-copy:not([aria-hidden]) a");
  const duplicates = document.querySelectorAll<HTMLAnchorElement>('.logo-wall-copy[aria-hidden="true"] a');
  expect(original.length).toBeGreaterThanOrEqual(2);
  expect(duplicates.length).toBe(original.length);
  expect([...original].every((link) => link.tabIndex === 0)).toBe(true);
  expect([...duplicates].every((link) => link.tabIndex === -1)).toBe(true);
  expect(new Set([...original].map((link) => link.getAttribute("href")))).toEqual(
    new Set(["/members/first/", "/members/second/"]),
  );
  document.body.replaceChildren();
});
