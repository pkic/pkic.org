import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release";

/** Fast coverage across shared layouts; the full catalog is an optional deeper sweep. */
const representativeRoutes = [
  "/",
  "/about/",
  "/about/board/",
  "/members/",
  "/news/",
  "/search/",
  "/votes/",
  "/sponsors/",
  "/events/",
  "/events/webinars/",
  "/events/2026/pqc-conference-amsterdam-nl/",
  "/events/2026/pqc-conference-amsterdam-nl/agenda/",
  "/events/2026/pqc-conference-amsterdam-nl/sponsors/",
  "/events/2026/pqc-conference-amsterdam-nl/register/",
  "/events/2026/webinar-entrust-reactive-to-resilient/",
  "/blog/",
  "/authors/bruce-morton/",
  "/tags/pqc/",
  "/2019/12/06/chrome-kills-mixed-content-for-https/",
  "/wg/",
  "/wg/pkimm/",
  "/wg/pkimm/1.0.0/categories/01-strategy-and-vision/",
  "/wg/cbom/charter/",
  "/wg/pqc/pqcmm/levels/3-advanced/",
  "/wg/pqc/pqcmm/",
  "/wg/pqc/pqcmm/levels/",
  "/join/",
  "/donate/",
  "/portal/",
  "/privacy/",
];
const routes =
  process.env.PKIC_CONTRAST_ALL === "1"
    ? sitePublicationReleaseSchema
        .parse(JSON.parse(readFileSync("dist/astro/publication.json", "utf8")))
        .files.filter((file) => file.endsWith("index.html"))
        .map((file) => `/${file.slice(0, -"index.html".length)}`)
    : representativeRoutes;

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });
    for (const route of routes) {
      test(`readable public text on ${route}`, async ({ page }) => {
        const response = await page.goto(route);
        expect(response?.ok()).toBe(true);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => undefined)),
          );
        });
        await page.evaluate(axe.source);
        const violations = await page.evaluate(async () => {
          const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "rule", values: ["color-contrast"] },
          });
          return result.violations.map((violation) => ({
            id: violation.id,
            nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })),
          }));
        });
        expect(violations).toEqual([]);
      });
    }
  });
}
