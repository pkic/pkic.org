/** Reported public-page regressions: #69–72. @covers presentation.13.7 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { groupDirectoryResponseSchema } from "../../assets/shared/schemas/group-directory";
import { sponsorsDisplayResponseSchema } from "../../assets/shared/schemas/public-sponsors";

// Controlled directory content makes the geometry test independent of which
// people currently hold office. The underlying APIs have D1 integration tests.
test("working-group introduction, leaders and social icons share the full row", async ({ page }) => {
  await page.route("**/api/v1/groups/tcwg/directory", async (route) => {
    const response = groupDirectoryResponseSchema.parse(await (await route.fetch()).json());
    response.leadership = ["Neal Fuerst", "Sandip Dholakia"].map((name, index) => ({
      person: {
        name,
        jobTitle: "Working group leadership",
        organizationName: null,
        organizationWebsite: null,
        organizationLogoUrl: null,
        photoUrl: index === 0 ? "/layout-portrait.jpg" : null,
        featuredLink: "https://www.linkedin.com/company/pki-consortium/",
      },
      title: index === 0 ? "Chair" : "Vice Chair",
      roleId: index === 0 ? "role-group_lead" : "role-group_deputy_lead",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      sourceGroup: response.group,
      inherited: false,
    }));
    await route.fulfill({ json: groupDirectoryResponseSchema.parse(response) });
  });
  await page.route("**/layout-portrait.jpg", (route) =>
    route.fulfill({ path: path.resolve("assets/images/members/keyfactor/neal-fuerst.jpg"), contentType: "image/jpeg" }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/wg/tcwg/");
  const intro = page.locator(".wg-intro-layout");
  await expect(intro.getByText("Sandip Dholakia", { exact: true })).toBeVisible();
  const columns = intro.locator(":scope > div");
  const main = await columns.nth(0).boundingBox();
  const aside = await columns.nth(1).boundingBox();
  const row = await intro.boundingBox();
  expect(main!.width).toBeGreaterThan(aside!.width * 1.5);
  expect(aside!.x + aside!.width).toBeCloseTo(row!.x + row!.width, 0);
  const initials = intro.locator(".person-card-avatar--initials");
  expect(await initials.evaluate((el) => getComputedStyle(el).display)).toBe("flex");
  const social = intro.getByRole("link", { name: /Sandip Dholakia on LinkedIn/ });
  await expect(social.locator("svg path")).toHaveCount(1);
  expect((await social.boundingBox())!.width).toBeLessThanOrEqual(28);
  await intro.screenshot({ path: test.info().outputPath("working-group-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMain = await columns.nth(0).boundingBox();
  const mobileAside = await columns.nth(1).boundingBox();
  expect(mobileAside!.y).toBeGreaterThan(mobileMain!.y + mobileMain!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await intro.screenshot({ path: test.info().outputPath("working-group-mobile.png") });

  await page.evaluate(() => localStorage.setItem("pk-theme", "dark"));
  await page.reload();
  await expect(intro.getByText("Sandip Dholakia", { exact: true })).toBeVisible();
  await intro.screenshot({ path: test.info().outputPath("working-group-dark.png") });
  const contrasts = await intro.locator(".person-card-name, .person-card-jobtitle").evaluateAll((names) =>
    names.map((name) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const srgb = value / 255;
            return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(getComputedStyle(name).color);
      const background = luminance(getComputedStyle(name.closest(".person-card")!).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    }),
  );
  for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test("working-group subpages separate Join from Back at both widths", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const slug of ["pkimm", "tcwg"]) {
      await page.goto(`/wg/${slug}/focus/`);
      const actions = page.locator(".wg-page-actions");
      const join = actions.getByRole("link", { name: /^Join/ });
      const back = actions.getByRole("link", { name: /Back to/ });
      const joinBox = await join.boundingBox();
      const backBox = await back.boundingBox();
      expect(backBox!.y - joinBox!.y - joinBox!.height).toBeGreaterThanOrEqual(15);
      expect(joinBox!.width).toBeLessThan(width - 24);
      await expect(back).toHaveAttribute("href", new RegExp(`/wg/${slug}/`));
    }
  }
});

test("blog sponsor artwork stays inside its column at every width", async ({ page }) => {
  const sponsors = [
    { id: "00000000-0000-4000-8000-000000000071", name: "Keyfactor", asset: "keyfactor/keyfactor.svg", weight: 6 },
    { id: "00000000-0000-4000-8000-000000000072", name: "Thales", asset: "thales/thales.svg", weight: 4 },
  ];
  await page.route("**/api/v1/sponsors/display?*", (route) =>
    route.fulfill({
      json: sponsorsDisplayResponseSchema.parse({
        groups: sponsors.map((s) => ({
          weight: s.weight,
          tierName: "Sponsor",
          sponsors: [
            {
              ...s,
              website: "https://pkic.org",
              logoUrl: `/layout-${s.name}.svg`,
              tier: "Sponsor",
              eventTier: null,
              effectiveTier: "Sponsor",
            },
          ],
        })),
        page: { total: 2, limit: 200, offset: 0, hasMore: false },
      }),
    }),
  );
  for (const sponsor of sponsors) {
    await page.route(`**/layout-${sponsor.name}.svg`, (route) =>
      route.fulfill({ path: path.resolve(`assets/images/members/${sponsor.asset}`), contentType: "image/svg+xml" }),
    );
  }
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/2025/01/30/key-takeaways-of-the-pqc-conference-in-austin/");
    const sidebar = page.locator(".blog-sidebar-sponsors");
    const logos = sidebar.locator("img.sponsor-logo");
    await expect(logos).toHaveCount(2);
    const bounds = await sidebar.boundingBox();
    for (const logo of await logos.all()) {
      await expect(logo).toBeVisible();
      await expect.poll(() => logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      const box = await logo.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x + 12);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width - 12);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await sidebar.screenshot({ path: test.info().outputPath(`blog-sponsors-${width}.png`) });
  }
});
