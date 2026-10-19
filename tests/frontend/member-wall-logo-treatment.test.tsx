// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { MemberWallView } from "../../assets/ts/site/SponsorDisplays";
import type { MemberWallEntry } from "../../assets/shared/schemas/members-directory";

const entry = (name: string, sponsorLevel: number): MemberWallEntry => ({
  key: name,
  href: `https://${name.toLowerCase()}.example`,
  logoUrl: `/img/${name.toLowerCase()}.svg`,
  name,
  slogan: null,
  sponsorLevel,
  sponsorLevelName: sponsorLevel > 0 ? "Gold" : null,
});

afterEach(() => document.body.replaceChildren());

describe("member wall logo treatment", () => {
  it("marks only sponsor logos for the full-strength treatment", () => {
    render(<MemberWallView entries={[entry("Alpha", 0), entry("Beta", 3)]} />, document.body);
    const member = document.querySelector<HTMLImageElement>('img[alt="Alpha"]');
    const sponsor = document.querySelector<HTMLImageElement>('img[alt="Beta"]');
    expect(member?.classList.contains("member-logo")).toBe(true);
    expect(member?.classList.contains("member-logo-sponsor")).toBe(false);
    expect(sponsor?.classList.contains("member-logo")).toBe(true);
    expect(sponsor?.classList.contains("member-logo-sponsor")).toBe(true);
  });
});

describe("member wall logo stylesheet", () => {
  const css = readFileSync("assets/ts/components/site-footer.css", "utf8");
  const components = css.slice(css.lastIndexOf("@layer components"));
  const rule = (selector: string): string => {
    const start = components.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return components.slice(start, components.indexOf("}", start));
  };

  it("mutes member logos through the theme filter, so the dark theme still inverts them", () => {
    const base = rule("  .member-logo");
    expect(base).toContain("filter: var(--pk-member-logo-filter)");
    expect(base).toContain("opacity: var(--member-logo-muted-opacity, 1)");
    expect(rule("  .members")).toMatch(/--member-logo-muted-opacity: 0\.\d+/);
  });

  it("keeps sponsors at full strength and restores any logo on hover and keyboard focus", () => {
    expect(rule("  .members .member-logo-sponsor")).toContain("opacity: 1");
    const restore = rule("  .members a:is(:hover, :focus-visible) .member-logo");
    expect(restore).toContain("opacity: 1");
    expect(restore).toContain("filter: var(--pk-member-logo-hover-filter)");
  });

  it("uses theme tokens rather than literal colors or filters", () => {
    expect(components).not.toMatch(/grayscale\(|#[0-9a-f]{3,6}\b|rgba?\(/i);
  });
});
