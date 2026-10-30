import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("public text contrast sources", () => {
  it("styles the member news feed link as a link inside the design system surface, not as a browser-default anchor", () => {
    expect(source("site/pages/news/[...page].astro")).toMatch(/<div class="pk">\s*<p>\s*<a href="\/news\/feed\.xml">/);
  });

  it("darkens the working group tint together with its lightened ink in both dark theme selectors", () => {
    const css = source("assets/ts/components/working-group-pages.css");
    for (const selector of [
      ':root[data-theme="dark"] .pk-site.pk-site--working-group',
      ':root:not([data-theme="light"]) .pk-site.pk-site--working-group',
    ]) {
      const block = css.slice(css.indexOf(selector));
      const body = block.slice(block.indexOf("{") + 1, block.indexOf("}"));
      expect(body, selector).toContain("--pk-accent-ink: color-mix(in oklab, var(--pk-accent) 70%, #fff)");
      expect(body, selector).toMatch(/--pk-accent-soft: color-mix\(in oklab, var\(--pk-accent\) \d+%, #000\)/);
    }
  });

  it("keeps the list view track label stronger than plain muted ink, which misses 4.5:1 on a tinted card", () => {
    const css = source("assets/ts/site/AgendaDesign.css");
    const rule = css.slice(
      css.indexOf('.pk-content-agenda[data-agenda-view="list"] .pk-content-agenda__room > .pk-content-agenda__track {'),
    );
    const body = rule.slice(rule.indexOf("{") + 1, rule.indexOf("}"));
    expect(body).not.toMatch(/color:\s*var\(--pk-ink-muted\)/);
    expect(body).toMatch(/color:\s*color-mix\(in oklab, var\(--pk-ink-muted\) \d+%, var\(--pk-ink\)\)/);
  });
});
