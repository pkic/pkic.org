import { expect, it } from "vitest";
import { loadSiteContent, publishedSiteRoutes } from "../functions/_lib/services/site-content";

// Full-catalog parity is opt-in migration validation, not a routine CI gate.
it("does not leave a published content route empty", async () => {
  /*
   * Routes the published site leaves empty too.
   *
   * Each of these renders its hero and nothing else on the reference —
   * `/meetings/` and `/invite/` publish only child sections, `/design/` and
   * `/meetings/join/` and `/m/` are meeting join stubs, and `/portal/` is a client island. They are
   * named rather than skipped by rule so a page that goes empty by accident
   * still fails here.
   */
  const publishedEmpty = new Set(["/design/", "/invite/", "/meetings/", "/meetings/join/", "/m/", "/portal/"]);
  const emptyRoutes: string[] = [];
  for (const route of publishedSiteRoutes()) {
    if (publishedEmpty.has(route)) continue;
    const page = await loadSiteContent(route);
    if (
      page &&
      !page.description &&
      !page.html.trim() &&
      !page.listing?.items.length &&
      !page.taxonomy &&
      !page.events &&
      // A working-group sub-page carries its cards, roster or blog roll in
      // the group payload rather than in rendered Markdown.
      !page.workingGroup &&
      !page.redirect &&
      route !== "/"
    ) {
      emptyRoutes.push(route);
    }
  }
  expect(emptyRoutes).toEqual([]);
}, 30_000);
