import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release";
import { constants } from "../../assets/design/tokens";
import { contrastRatio } from "../../assets/design/color";

async function openPublishedAgenda(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("[data-agenda-controls]")).not.toHaveAttribute("hidden");
}

test("anonymous first paint keeps application styles and service notices lazy", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const logo = page
    .getByRole("navigation", { name: "Main", exact: true })
    .getByRole("img", { name: "PKI Consortium", exact: true });
  const bounds = await logo.boundingBox();
  expect(bounds!.height).toBeGreaterThan(20);
  expect(bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.width < 736 ? 32 : 40);
  expect(Math.abs(bounds!.width / bounds!.height - 1256 / 324)).toBeLessThan(0.1);
  expect(requests.filter((path) => /availability-notice|editor|PortalPage/.test(path))).toEqual([]);
  expect(requests.filter((path) => path.includes("/api/"))).toEqual([]);
  const styles = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  expect(styles.length).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});

test("public social previews use complete static cards for every published variant", async ({ page, request }) => {
  const response = await request.get("/_published/social/cards.json");
  expect(response.ok()).toBe(true);
  const cards: Array<{ route: string; kind: string; url: string; width: number; height: number }> =
    await response.json();
  expect(cards.length).toBeGreaterThan(500);
  expect(new Set(cards.map((card) => card.kind))).toEqual(
    new Set(["community", "member", "working-group", "event", "webinar", "article", "author", "page"]),
  );
  const release = sitePublicationReleaseSchema.parse(await (await request.get("/publication.json")).json());
  for (const card of cards) {
    expect(card.route).not.toMatch(/^\/portal\//);
    expect(card.width).toBe(1200);
    expect(card.height).toBe(630);
    expect(card.url).toMatch(/^\/_published\/social\/[a-f0-9]{64}\.jpg$/);
    expect(release.files).toContain(card.url.slice(1));
    expect(release.redirects).toContainEqual({
      from: `/og/${card.route.replace(/^\/|\/$/g, "") || "index"}/og.jpg`,
      to: card.url,
      status: 302,
    });
  }
  await page.route("**/api/**", (route) => route.abort());
  for (const kind of new Set(cards.map((card) => card.kind))) {
    const card = cards.find((entry) => entry.kind === kind)!;
    await page.goto(card.route);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `https://pkic.org${card.url}`);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", `https://pkic.org${card.url}`);
    const image = await request.get(card.url);
    expect(image.ok()).toBe(true);
    expect(image.headers()["content-type"]).toMatch(/image\/jpeg/);
    expect(Array.from((await image.body()).subarray(0, 2))).toEqual([255, 216]);
    expect(await page.locator("#pkic-social-card").count()).toBe(0);
  }
  await page.goto("/portal/");
  expect(await page.locator('meta[property="og:image"]').count()).toBe(0);
});

test("membership organization choices occupy separate full-width rows", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/join/");
  const choices = page.locator("[data-join-start-form] .pk-check");
  await expect(choices).toHaveCount(2);
  const first = await choices.nth(0).boundingBox();
  const second = await choices.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
  expect(Math.abs(second!.x - first!.x)).toBeLessThan(1);
  expect(Math.abs(second!.width - first!.width)).toBeLessThan(1);
});

test("sponsor brochures and authored session slides download from static files", async ({ page, request }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/sponsors/");
  const brochure = page.getByRole("link", { name: "Sponsor Brochure", exact: true });
  const brochureUrl = new URL((await brochure.getAttribute("href"))!, page.url());
  expect(brochureUrl.pathname).toBe("/sponsors/pkic-sponsors.pdf");
  const response = await request.get(brochureUrl.href);
  expect(response.ok()).toBe(true);
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/events/2023/pqc-conference-amsterdam-nl/");
  const dialog = page
    .locator("dialog")
    .filter({ has: page.locator("a[download]") })
    .first();
  const dialogId = await dialog.getAttribute("id");
  await page.locator(`[data-agenda-open-session="${dialogId}"]`).first().click();
  const slides = dialog.getByRole("link", { name: "Download Slides", exact: true });
  await expect(slides).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await slides.click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});

test("responsive image variants load as static assets at mobile, tablet, and desktop widths", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/events/2026/pqc-conference-amsterdam-nl/", { waitUntil: "networkidle" });
    const hero = page.locator("img.pkic-hero-media__image");
    await expect(hero).toHaveAttribute("fetchpriority", "high");
    await expect(hero).toHaveAttribute("sizes", "100vw");
    const loaded = await hero.evaluate((image: HTMLImageElement) => ({
      source: image.currentSrc,
      width: image.naturalWidth,
      renderedWidth: image.getBoundingClientRect().width,
      candidates: image.srcset,
      format: image.parentElement?.querySelector("source")?.type,
    }));
    expect(loaded.source).toMatch(/\/_assets\/.*\.avif$/);
    expect(loaded.width).toBeGreaterThan(0);
    expect(loaded.renderedWidth).toBeCloseTo(width, 0);
    expect(loaded.format).toBe("image/avif");
    expect(loaded.candidates).toContain("640w");
    const response = await page.request.get(loaded.source);
    expect(response.ok()).toBe(true);
    expect((await response.body()).length).toBeLessThan(300_000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("publishes discovery from the same static release without indexing previews", async ({ request }) => {
  const response = await request.get("/publication.json");
  const release = sitePublicationReleaseSchema.parse(await response.json());
  for (const file of ["robots.txt", "sitemap.xml", "en/sitemap.xml", "ms/sitemap.xml"]) {
    expect(release.files).toContain(file);
    expect((await request.get(`/${file}`)).ok()).toBe(true);
  }
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
  const sitemap = await (await request.get("/en/sitemap.xml")).text();
  expect(sitemap).toContain("https://pkic.org/members/example-corp/");
  expect(sitemap).not.toContain("/api/");
});

test("every published public page browses without an API request", async ({ browser, request }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The complete catalog is checked once; responsive journeys run in both projects.",
  );
  test.setTimeout(600_000);
  const response = await request.get("/publication.json");
  expect(response.ok()).toBe(true);
  const release = sitePublicationReleaseSchema.parse(await response.json());
  const routes = release.files
    .filter((file) => file.endsWith("index.html"))
    .map((file) => `/${file.slice(0, -"index.html".length)}`);
  expect(routes.length).toBeGreaterThan(500);
  const failures: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
      const page = await context.newPage();
      let route = "";
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(`PKIC_CSP_VIOLATION:${event.effectiveDirective}:${event.blockedURI}`);
        });
      });
      page.on("console", (message) => {
        if (message.text().startsWith("PKIC_CSP_VIOLATION:")) failures.push(`${route}: ${message.text()}`);
      });
      await context.route("**/api/**", async (requestRoute) => {
        failures.push(`${route}: ${requestRoute.request().method()} ${requestRoute.request().url()}`);
        await requestRoute.abort();
      });
      page.on("pageerror", (error) => failures.push(`${route}: ${error.message}`));
      page.on("response", (resource) => {
        if (resource.status() >= 400 && new URL(resource.url()).origin === new URL(page.url()).origin)
          failures.push(`${route}: static resource ${resource.status()} ${resource.url()}`);
      });
      try {
        while (next < routes.length) {
          route = routes[next++]!;
          const result = await page.goto(route);
          expect(result?.status(), route).toBe(200);
          await expect(page.locator("body > main"), route).toBeVisible();
          await page.waitForLoadState("networkidle");
        }
      } finally {
        await context.close();
      }
    }),
  );
  expect(failures).toEqual([]);
});

test("published pages, navigation, and search browse without API requests", async ({ page }, testInfo) => {
  const apiRequests: string[] = [];
  const searchDocuments: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.isNavigationRequest() && url.pathname === "/search/") searchDocuments.push(url.search);
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    apiRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto("/members/");
  await expect(page.getByRole("main").getByRole("link", { name: "Example Corp", exact: true })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Example Corp", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Example Corp", exact: true })).toBeVisible();
  await expect(page.getByText("This approved content comes from a publication snapshot.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest member news", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Synthetic member news", exact: true })).toBeVisible();
  const publishedWall = page.locator(".footer-member-wall");
  await publishedWall.scrollIntoViewIfNeeded();
  const wallImage = publishedWall.getByRole("img", { name: "Example Corp", exact: true }).first();
  await expect(wallImage).toBeVisible();
  await expect
    .poll(() => wallImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);

  await page.screenshot({ path: testInfo.outputPath("member-profile.png"), fullPage: true });

  await page.goto("/news/");
  await expect(page.getByRole("link", { name: "Synthetic member news", exact: true })).toBeVisible();
  const newsData = await page.request.get("/_published/news/page-1.json");
  expect(newsData.ok()).toBe(true);
  expect((await newsData.json()).articles[0].title).toBe("Synthetic member news");
  const feed = await page.request.get("/news/feed.xml");
  expect(feed.ok()).toBe(true);
  expect(await feed.text()).toContain("Synthetic member news");

  await page.goto("/votes/");
  await page.getByRole("main").getByRole("link", { name: "Charter amendment", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Charter amendment", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("Passed", { exact: true })).toBeVisible();
  await page.goto("/votes/detail/?slug=charter-amendment");
  await expect(page).toHaveURL(/\/votes\/charter-amendment\/$/);
  await expect(page.getByRole("main").getByText("Passed", { exact: true })).toBeVisible();

  await page.goto("/wg/pkimm/");
  await expect(page.getByText("Synthetic Chair", { exact: true })).toBeVisible();
  const heroButton = page.locator(".pkic-page-hero .pk-btn");
  await expect(heroButton).toHaveText("Join the PKIMM Working Group");
  expect(
    await heroButton.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.color !== style.backgroundColor;
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("working-group.png"), fullPage: true });

  await page.goto("/2016/10/19/why-is-certificate-expiration-necessary/");
  await expect(
    page.getByRole("heading", { name: "Why Is Certificate Expiration Necessary?", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("The Long Life Certificate – Why It Doesn’t Exist", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("blog.png"), fullPage: true });

  const searchButton = page.getByRole("button", { name: /^(Open search|Search)$/ });
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Toggle navigation" }).click();
  await searchButton.filter({ visible: true }).first().click();
  await page.getByRole("searchbox", { name: "Search", exact: true }).filter({ visible: true }).fill("approved content");
  await expect(page.getByRole("link").filter({ hasText: "Example Corp" }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("search.png"), fullPage: true });

  await page.goto("/search/#q=approved+content");
  await expect(page.getByRole("link").filter({ hasText: "Example Corp" }).first()).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search", exact: true })
    .filter({ visible: true })
    .fill("Charter amendment");
  await expect(page).toHaveURL(/\/search\/#q=Charter\+amendment$/);
  await expect(page.getByRole("link").filter({ hasText: "Charter amendment" }).first()).toBeVisible();
  expect(searchDocuments).toEqual([""]);
  await page.reload();
  await expect(page.getByRole("link").filter({ hasText: "Charter amendment" }).first()).toBeVisible();
  expect(searchDocuments).toEqual(["", ""]);

  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("the private portal checks its session and opens the existing sign-in form", async ({ page }, testInfo) => {
  const requests: string[] = [];
  let submittedEmail: string | undefined;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === "/api/v1/auth/request-link") {
      submittedEmail = userAuthRequestSchema.parse(route.request().postDataJSON()).email;
      await route.fulfill({ status: 200, json: { success: true } });
      return;
    }
    await route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "Sign in required" } } });
  });
  await page.goto("/portal/");
  await expect(page.locator("#pkic-public-form-resources")).toHaveCount(0);
  await expect(page.locator("#portal-app")).toHaveJSProperty("inert", false);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(requests).toEqual(["/api/v1/auth/session"]);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Member portal", exact: true })).toHaveCount(0);
  const emailOption = page.getByRole("button", { name: "Sign in with an email link", exact: true });
  if (await emailOption.isVisible()) await emailOption.click();
  await page.getByRole("textbox", { name: "Work email" }).fill("synthetic@example.test");
  await page.getByRole("button", { name: /Send.*link/i }).click();
  await expect(page.getByText("Check your email", { exact: true })).toBeVisible();
  expect(submittedEmail).toBe("synthetic@example.test");
  expect(requests).toEqual(["/api/v1/auth/session", "/api/v1/auth/request-link"]);
  await page.screenshot({ path: testInfo.outputPath("portal-sign-in.png"), fullPage: true });
});

test("member content is readable with JavaScript disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/members/example-corp/`);
    await expect(page.getByRole("heading", { name: "Published profile", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Back to members", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("published donation and application-status controls open without API requests", async ({ page }) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    apiRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto("/donate/");
  await expect(page.getByRole("textbox", { name: "Full name (required)", exact: true })).toBeVisible();
  await expect(page.getByLabel("Currency", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Donate / })).toBeEnabled();
  await page.getByLabel("Currency", { exact: true }).selectOption("eur");
  await expect(page.locator("[data-donation-currency-prefix]")).toHaveText("€");
  await page.waitForLoadState("networkidle");
  await page.goto("/donate/complete/");
  await expect(page.locator("[data-donation-badge]")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.goto("/application-status/");
  await expect(page.locator("[data-link-help]")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`public footer and heading links are accessible in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    for (const route of [
      "/events/2026/pqc-conference-amsterdam-nl/",
      "/events/2026/pqc-conference-amsterdam-nl/agenda/",
    ]) {
      await page.goto(route);
      await page.evaluate(axe.source);
      const violations = await page.evaluate(async () => {
        const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
          runOnly: { type: "rule", values: ["color-contrast", "heading-order", "link-name"] },
        });
        return result.violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => node.target),
        }));
      });
      expect(violations).toEqual([]);
    }
  });
  test(`published portraits and blog cards remain readable in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/wg/pkimm/");
    const frame = page.locator(".person-card-avatar-frame").first();
    await expect(frame).toBeVisible();
    const geometry = await frame.evaluate((element) => {
      const outer = element.getBoundingClientRect();
      const portrait = element.querySelector('[aria-hidden="true"]')!.getBoundingClientRect();
      return {
        horizontalInset: (outer.width - portrait.width) / 2,
        verticalInset: (outer.height - portrait.height) / 2,
        offsetX: portrait.x - outer.x,
        offsetY: portrait.y - outer.y,
      };
    });
    expect(geometry.offsetX).toBeCloseTo(geometry.horizontalInset, 1);
    expect(geometry.offsetY).toBeCloseTo(geometry.verticalInset, 1);
    expect(geometry.horizontalInset).toBeGreaterThan(0);
    const spacing = await frame
      .locator("..")
      .locator("..")
      .evaluate((card) => {
        const name = card.querySelector(".person-card-name")!.getBoundingClientRect();
        const title = card.querySelector(".person-card-jobtitle")!.getBoundingClientRect();
        const logo = card.querySelector(".person-card-org-logo")!.getBoundingClientRect();
        const footer = card.querySelector(".person-card-footer")!.getBoundingClientRect();
        return { nameGap: title.top - name.bottom, footerGap: footer.top - logo.bottom };
      });
    expect(spacing.nameGap).toBeLessThanOrEqual(12);
    expect(spacing.footerGap).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: testInfo.outputPath(`portrait-${colorScheme}.png`), fullPage: true });

    await page.goto("/blog/");
    await expect(page.locator(".blog-card-summary").first()).toBeVisible();
    if (testInfo.project.name === "mobile") {
      const width = await page
        .locator(".blog-card")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 32);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
    }
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(".blog-card-body", {
        runOnly: { type: "rule", values: ["color-contrast"] },
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      }));
    });
    expect(violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`blog-${colorScheme}.png`), fullPage: true });
  });
}

test("sponsored webinars publish their sponsor logo and disclosure", async ({ page, request }) => {
  await page.goto("/events/2026/webinar-entrust-reactive-to-resilient/");
  const notice = page.getByRole("complementary", { name: "Sponsored webinar" });
  await expect(notice).toContainText("presented by Entrust");
  await expect(notice.getByRole("img", { name: "Entrust", exact: true })).toBeVisible();
  const src = await notice.getByRole("img", { name: "Entrust", exact: true }).getAttribute("src");
  expect((await request.get(src!)).ok()).toBe(true);
});

test("working-group sections scroll in one row and retain dropdowns", async ({ page }, testInfo) => {
  await page.goto("/wg/pkimm/");
  const rail = page.locator("#wgSectionNav > .pk-container");
  const positions = await rail
    .locator(":scope > *")
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
  expect(new Set(positions.map(Math.round)).size).toBe(1);
  if (testInfo.project.name === "mobile") {
    expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await rail.evaluate((element) => getComputedStyle(element).backgroundAttachment)).toBe(
      "local, local, scroll, scroll",
    );
    await rail.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    expect(await rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(rail.getByRole("link", { name: "Blog", exact: true })).toBeInViewport();
  }
  const disclosure = rail.getByRole("button", { name: "Show contents" }).first();
  await disclosure.scrollIntoViewIfNeeded();
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".wg-nav-tree-panel:visible")).toBeVisible();
  const versions = page.getByRole("group", { name: "Switch PKIMM model version" });
  await expect(versions.getByRole("link", { name: "2.0.0 Latest release" })).toHaveAttribute(
    "href",
    "/wg/pkimm/model/",
  );
  await expect(versions.getByRole("link", { name: "1.0.0", exact: true })).toHaveAttribute("href", "/wg/pkimm/1.0.0/");
  await page.screenshot({ path: testInfo.outputPath("section-navigation.png"), fullPage: true });
});

test("mobile search fields stay readable without disabling viewport zoom", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Touch-specific control sizing");
  await page.goto("/search/");
  const input = page.getByRole("searchbox", { name: "Search", exact: true }).filter({ visible: true });
  await expect(input).toBeVisible();
  expect(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await input.focus();
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1/);
});

test("model versions preserve equivalent pages and fall back for new categories", async ({ page }) => {
  await page.goto("/wg/pkimm/model/categories/");
  let versions = page.getByRole("group", { name: "Switch PKIMM model version", includeHidden: true });
  await expect(versions.getByRole("link", { name: "1.0.0", exact: true, includeHidden: true })).toHaveAttribute(
    "href",
    "/wg/pkimm/1.0.0/categories/",
  );
  await expect(versions.getByRole("link", { name: "2.0.0 Latest release", includeHidden: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/wg/pkimm/model/categories/cryptography/");
  versions = page.getByRole("group", { name: "Switch PKIMM model version", includeHidden: true });
  await expect(versions.getByRole("link", { name: "1.0.0 Overview", includeHidden: true })).toHaveAttribute(
    "href",
    "/wg/pkimm/1.0.0/",
  );
});

test("mobile hamburger stays at the right in normal, menu, and search states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile navigation layout");
  for (const route of ["/", "/blog/", "/wg/pkimm/"]) {
    await page.goto(route);
    const menu = page.getByRole("button", { name: "Toggle navigation" });
    const controls = page.locator(".pkic-navbar-utilities");
    const checkPosition = async () => {
      const bounds = await menu.boundingBox();
      const utilities = await controls.boundingBox();
      expect(bounds).not.toBeNull();
      expect(utilities!.x + utilities!.width).toBeLessThanOrEqual(bounds!.x);
      expect(page.viewportSize()!.width - bounds!.x - bounds!.width).toBeCloseTo(16, 0);
    };
    await checkPosition();
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await checkPosition();
    await controls.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByRole("searchbox", { name: "Search", exact: true }).filter({ visible: true })).toBeVisible();
    await checkPosition();
  }
});

test("PQC registration uses published configuration and a warning card without API reads", async ({ page }) => {
  const reads: string[] = [];
  await page.route("**/api/**", async (route) => {
    reads.push(route.request().url());
    await route.abort();
  });
  await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
  const warning = page.getByText("In-person registration is currently full.").locator("xpath=ancestor::blockquote[1]");
  await expect(warning).toBeVisible();
  expect(await warning.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe("0px");
  await expect(page.getByText("Could not load registration form details. Reload this page to try again.")).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Continue", exact: false }).first()).toBeEnabled();
  expect(reads).toEqual([]);
});

test("PQC agenda uses full-width mobile sessions and bounded desktop scrolling", async ({ page }, testInfo) => {
  await openPublishedAgenda(page, "/events/2026/pqc-conference-amsterdam-nl/agenda/");
  const agenda = page.getByRole("region", { name: "Event agenda" });
  const panel = agenda.getByRole("tabpanel");
  const slot = panel
    .locator(".pk-content-agenda__slot")
    .filter({ has: page.getByRole("heading", { name: "Opening", exact: true }) });
  await expect(slot).toBeVisible();
  const session = slot.locator(".pk-content-agenda__session").first();
  await expect(session.locator(".pk-content-agenda__room")).toHaveText("Red hall");
  const portrait = session.locator(".pk-avatar__img").first();
  await expect(portrait).toHaveAttribute("src", /^\/_assets\//);
  if (testInfo.project.name === "mobile") {
    const controls = agenda.locator("[data-agenda-controls]");
    await slot.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const toolbar = await controls.boundingBox();
        const submenu = await page.getByRole("navigation", { name: "Event pages" }).boundingBox();
        return toolbar!.y - (submenu!.y + submenu!.height);
      })
      .toBeGreaterThanOrEqual(-0.5);
    await expect(controls.locator("[data-agenda-expand]")).toBeInViewport();
    const bounds = await session.boundingBox();
    const time = await slot.locator(".pk-content-agenda__time").boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 32);
    expect(time!.y + time!.height).toBeLessThanOrEqual(bounds!.y);
    await expect(session.locator(".pk-content-agenda__room")).toBeVisible();
  } else {
    const geometry = page.locator("link[data-agenda-layout]");
    await expect(geometry).toHaveAttribute("href", /^\/_published\/agenda\/[a-f0-9]+\.css$/);
    const geometryResponse = await page.request.get((await geometry.getAttribute("href"))!);
    expect(geometryResponse.ok()).toBe(true);
    await expect(page.getByRole("navigation", { name: "Event pages" }).locator('[aria-current="page"]')).toHaveText(
      "Agenda",
    );
    await expect(session.locator(".pk-content-agenda__room")).toBeHidden();
    await expect(panel.locator("thead")).toBeVisible();
    const rows = await panel.locator(".pk-content-agenda__slot").evaluateAll((elements) =>
      elements
        .filter((row) => row.querySelector(".pk-content-agenda__session"))
        .map((row) => ({
          actual: row.getBoundingClientRect().height,
          scheduled: Number((row as HTMLElement).dataset.agendaHeight),
        })),
    );
    for (const row of rows) expect(Math.abs(row.actual - row.scheduled)).toBeLessThanOrEqual(2);
    expect(
      await session
        .locator(".pk-content-agenda__description")
        .evaluate((element) => getComputedStyle(element).maskImage),
    ).toContain("linear-gradient");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
  const right = agenda.getByRole("button", { name: "Scroll agenda right", exact: true });
  const left = agenda.getByRole("button", { name: "Scroll agenda left", exact: true });
  if (testInfo.project.name === "desktop") {
    await expect(right).toBeVisible();
    await expect(left).toBeDisabled();
    const afternoon = panel.getByRole("heading", {
      name: "PQC Budgeting: How to Address the Costs of PQC Readiness",
      exact: true,
    });
    await afternoon.scrollIntoViewIfNeeded();
    const controlBox = (await right.boundingBox())!;
    const submenuBox = (await page.getByRole("navigation", { name: "Event pages" }).boundingBox())!;
    expect(controlBox.y).toBeGreaterThanOrEqual(submenuBox.y + submenuBox.height - 0.5);
    expect(controlBox.y + controlBox.height).toBeLessThan(page.viewportSize()!.height);
    expect(
      await right.evaluate((button) => {
        const box = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }),
    ).toBe(true);
    const durationBounds = await panel.locator(".pk-content-agenda__session").evaluateAll((cards) =>
      cards.map((card) => {
        const footer = card.querySelector(".pk-content-agenda__duration")?.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        const style = getComputedStyle(card);
        return footer
          ? {
              gap: box.bottom - footer.bottom,
              padding: Number.parseFloat(style.paddingBottom),
              border: Number.parseFloat(style.borderBottomWidth),
            }
          : null;
      }),
    );
    for (const bounds of durationBounds)
      if (bounds !== null) {
        expect(bounds.padding).toBe(4);
        expect(Math.abs(bounds.gap - bounds.padding - bounds.border)).toBeLessThanOrEqual(1);
      }
    await page.screenshot({ path: testInfo.outputPath("agenda-sticky-controls.png") });
    await right.click();
    await expect.poll(() => panel.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(left).toBeEnabled();
    await left.click();
    await expect.poll(() => panel.evaluate((element) => element.scrollLeft)).toBe(0);
  } else {
    await expect(right).toBeHidden();
  }
  await expect(session).toHaveCSS("border-top-width", "2px");
  expect(
    await session.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius)),
  ).toBeGreaterThan(0);
  const duration = session.locator(".pk-content-agenda__duration");
  await expect(duration).toHaveCSS("font-size", "12px");
  const box = (await session.boundingBox())!;
  const durationBox = (await duration.boundingBox())!;
  await expect(session).toHaveCSS("padding-bottom", "4px");
  const bottomBorder = await session.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).borderBottomWidth),
  );
  expect(Math.abs(box.y + box.height - durationBox.y - durationBox.height - 4 - bottomBorder)).toBeLessThanOrEqual(1);
  const restingBorder = await session.evaluate((element) => getComputedStyle(element).borderTopColor);
  await session.hover();
  await expect
    .poll(() => session.evaluate((element) => getComputedStyle(element).borderTopColor))
    .not.toBe(restingBorder);
  await expect(session).not.toHaveCSS("box-shadow", "none");
  await session.screenshot({ path: testInfo.outputPath("agenda-card-hover.png") });
  // Click the card's padding, away from its title and media links.
  await session.click({ position: { x: box.width / 2, y: box.height - 4 } });
  const details = page.getByRole("dialog", { name: "Opening", exact: true });
  await expect(details).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(details.getByRole("heading", { name: "Abstract", exact: true })).toBeVisible();
  await expect(details.getByRole("heading", { name: "Speakers", exact: true })).toBeVisible();
  await expect(details.getByText("Red hall", { exact: true })).toBeVisible();
  await expect(details.locator(".pk-content-agenda__metadata")).toContainText(/09:00.*09:30/);
  await page.keyboard.press("Escape");
  await expect(details).not.toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/agenda-modal-open/);
  await agenda.getByRole("tab", { name: "Wednesday" }).click();
  await expect(agenda.getByRole("tab", { name: "Wednesday" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("agenda.png"), fullPage: true });
  await agenda.getByRole("tab", { name: "Speakers", exact: true }).click();
  const speakerCard = agenda.locator(".pk-content-agenda__speakers article").filter({
    has: page.getByRole("heading", { name: "Paul van Brouwershaven", exact: true }),
  });
  await expect(speakerCard).toBeVisible();
  const headshot = speakerCard.locator("img").first();
  await expect(headshot).toBeVisible();
  await expect(headshot).toHaveCSS("width", "40px");
  await expect(headshot).toHaveCSS("height", "40px");
  await expect
    .poll(() => headshot.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  const biography = speakerCard.locator(".pk-content-agenda__speaker-bio");
  await expect(biography).toHaveCSS("font-size", "13px");
  await biography.locator("summary").click();
  await expect(biography).toHaveAttribute("open", "");
  await expect(biography.locator(":scope > :not(summary)")).toBeVisible();
  await expect(biography.locator(":scope > :not(summary)")).not.toHaveText("");
  await expect(speakerCard.getByRole("link", { name: /Paul van Brouwershaven on LinkedIn/ })).toBeVisible();
  await speakerCard.screenshot({ path: testInfo.outputPath("agenda-speaker-card.png") });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`agenda room filters and session dialogs are readable in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await openPublishedAgenda(page, "/events/2026/pqc-conference-amsterdam-nl/agenda/");
    await page.evaluate(axe.source);
    const contrastViolations = async (selector: string) =>
      page.evaluate(async (target) => {
        const result = await (window as unknown as { axe: typeof axe }).axe.run(target, {
          runOnly: { type: "rule", values: ["color-contrast", "button-name"] },
        });
        return result.violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => node.target),
        }));
      }, selector);
    expect(await contrastViolations(".pk-content-agenda")).toEqual([]);
    await page
      .getByRole("link", { name: "Open session details: Opening", exact: true })
      .or(page.getByRole("button", { name: "Open session details: Opening", exact: true }))
      .click();
    await expect(page.getByRole("dialog", { name: "Opening", exact: true })).toBeVisible();
    expect(await contrastViolations("dialog[open]")).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`agenda-dialog-${colorScheme}.png`) });
  });
}

test("agenda shows the event clock and the viewer's local clock without API calls", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, timezoneId: "America/New_York" });
  const page = await context.newPage();
  const calls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(request.url());
  });
  try {
    await openPublishedAgenda(page, "/events/2026/pqc-conference-amsterdam-nl/agenda/");
    const agenda = page.getByRole("region", { name: "Event agenda", exact: true });
    const panel = agenda.getByRole("tabpanel");
    const opening = page
      .locator(".pk-content-agenda__slot")
      .filter({
        has: page.getByRole("heading", { name: "Opening", exact: true }),
      })
      .first();
    const zoneKey = panel
      .locator(".pk-content-agenda__time-heading, .pk-content-agenda__zone-key")
      .filter({ visible: true });
    await expect(zoneKey).toHaveCount(1);
    const eventZone = zoneKey.locator('[title="Europe/Amsterdam"]');
    await expect(eventZone).toBeVisible();
    await expect(eventZone).toHaveText(/^Event(?: time)? · Amsterdam$/);
    await expect(eventZone).toHaveAttribute("title", "Europe/Amsterdam");
    await expect(zoneKey.locator("[data-agenda-browser-zone]")).toHaveText("Your time · America/New_York");
    await expect(zoneKey.locator("[data-agenda-browser-zone]")).toBeVisible();
    const eventClock = opening.locator('.pk-content-agenda__clock[aria-label="Event time"] > time');
    const viewerClock = opening.locator('[aria-label="Your time"] > time');
    await expect(eventClock).toBeVisible();
    await expect(eventClock).toHaveText("09:00");
    await expect(eventClock).toHaveAttribute("datetime", /T08:00:00(?:\.000)?Z$/);
    await expect(viewerClock).toBeVisible();
    await expect(viewerClock).toHaveText("03:00");
    await expect(viewerClock).toHaveAttribute("datetime", (await eventClock.getAttribute("datetime"))!);
    const display = agenda.getByRole("combobox", { name: "Agenda time display", exact: true });
    await expect(display).toHaveValue("venue");
    await display.selectOption("browser");
    await expect(agenda).toHaveAttribute("data-agenda-time-display", "browser");
    await expect(viewerClock).toHaveText("03:00");
    await expect(eventClock).toHaveText("09:00");
    await display.selectOption("venue");
    await expect(agenda).toHaveAttribute("data-agenda-time-display", "venue");
    await page.waitForLoadState("networkidle");
    expect(calls).toEqual([]);
  } finally {
    await context.close();
  }
});

test("event hero overlays sponsor logos on the image above the submenu on every screen size", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  await page.goto("/events/2026/pqc-conference-amsterdam-nl/");
  const action = page.getByRole("link", { name: "Secure your seat →", exact: true });
  await expect(action).toBeVisible();
  for (const hovered of [false, true]) {
    if (hovered) await action.hover();
    const colors = await action.evaluate((element, token) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const brightness = style.filter === "none" ? 1 : Number(/^brightness\(([\d.]+)\)$/.exec(style.filter)?.[1]);
      if (!Number.isFinite(brightness)) throw new Error(`Unsupported hero filter: ${style.filter}`);
      const reference = document.createElement("div");
      reference.hidden = true;
      reference.style.backgroundColor = token;
      document.body.appendChild(reference);
      const expectedBackground = getComputedStyle(reference).backgroundColor;
      reference.remove();
      const rgb = (color: string, factor = 1) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return {
          r: Math.min((r / 255) * factor, 1),
          g: Math.min((g / 255) * factor, 1),
          b: Math.min((b / 255) * factor, 1),
        };
      };
      return {
        token: rgb(style.getPropertyValue("--pk-public-hero-action").trim()),
        background: rgb(style.backgroundColor),
        expected: rgb(expectedBackground),
        displayedBackground: rgb(style.backgroundColor, brightness),
        displayedText: rgb(style.color, brightness),
      };
    }, constants["public-hero-action"]);
    expect(colors.token).toEqual(colors.expected);
    expect(colors.background).toEqual(colors.expected);
    expect(contrastRatio(colors.displayedText, colors.displayedBackground)).toBeGreaterThanOrEqual(4.5);
  }
  const organizers = page.getByRole("img", { name: "Main conference organizers", exact: true });
  await expect(organizers).toBeVisible();
  const centered = await organizers.evaluate((image) => {
    const box = image.getBoundingClientRect();
    const figure = image.closest("figure")!.getBoundingClientRect();
    return Math.abs(box.x + box.width / 2 - figure.x - figure.width / 2);
  });
  expect(centered).toBeLessThan(2);
  const band = page.locator(".pkic-hero-sponsor-band");
  await expect(band.getByRole("img", { name: /Synthetic conference sponsor/ })).toBeVisible();
  await expect
    .poll(() => band.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const geometry = await band.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hero = element.parentElement!.getBoundingClientRect();
    return {
      position: getComputedStyle(element).position,
      bottom: rect.bottom,
      heroBottom: hero.bottom,
      width: rect.width,
      viewport: innerWidth,
      overflow: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.position).toBe("absolute");
  expect(geometry.bottom).toBeCloseTo(geometry.heroBottom, 0);
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.overflow).toBeLessThanOrEqual(geometry.viewport);
  await page.screenshot({ path: testInfo.outputPath("event-hero-sponsors.png") });
  expect(requests).toEqual([]);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`author archives and blog details remain readable in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/authors/bruce-morton/");
    const firstPost = page.getByRole("article").first();
    await expect(firstPost).toBeVisible();
    await expect(firstPost).toHaveClass("blog-card");
    const title = firstPost.getByRole("heading", { level: 2 });
    const header = page.getByRole("heading", { level: 1 });
    const titleBox = await firstPost.boundingBox();
    const headerBox = await header.boundingBox();
    expect(titleBox!.y - headerBox!.y - headerBox!.height).toBeLessThan(130);
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(".blog-taxonomy-body", {
        runOnly: { type: "rule", values: ["color-contrast"] },
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      }));
    });
    expect(violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`author-${colorScheme}.png`) });
    await title.getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Bruce Morton", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
    await page.screenshot({ path: testInfo.outputPath(`blog-detail-${colorScheme}.png`) });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`home notices, member logos, and working-group links stay legible in ${colorScheme} mode`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    const notice = page.locator(".pk-content-alert").first();
    const icon = await notice.locator('span[aria-hidden="true"]').boundingBox();
    const body = await notice.locator(".pk-alert__body").boundingBox();
    expect(body!.x).toBeGreaterThan(icon!.x + icon!.width);
    expect(Math.abs(body!.y - icon!.y)).toBeLessThan(4);
    expect(
      await notice.locator(".pk-alert__body > :first-child").evaluate((element) => getComputedStyle(element).marginTop),
    ).toBe("0px");
    const logo = page.locator("[data-published-member-wall]").getByRole("img").first();
    if (testInfo.project.name === "desktop") {
      await logo.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          logo.evaluate((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth > 0;
          }),
        )
        .toBe(true);
      expect(
        await logo.evaluate((element) => {
          const image = element as HTMLImageElement;
          return Math.abs(image.clientWidth / image.clientHeight / (image.naturalWidth / image.naturalHeight) - 1);
        }),
      ).toBeLessThan(0.1);
      expect((await logo.boundingBox())!.width).toBeLessThan(200);
    }
    const card = page.locator(".pkic-wg-spotlight").first();
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(
        ".pkic-home-hero, .pk-content-alert, .pkic-wg-spotlight",
        {
          runOnly: { type: "rule", values: ["color-contrast"] },
        },
      );
      return result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      }));
    });
    expect(violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`home-${colorScheme}-details.png`) });
  });
}

test("taxonomy RSS feeds are discoverable, complete and included in the static release", async ({ page, request }) => {
  const release = sitePublicationReleaseSchema.parse(await (await request.get("/publication.json")).json());
  for (const [route, feed] of [
    ["/authors/bruce-morton/page/2/", "/feed/authors/bruce-morton/index.xml"],
    ["/tags/ca/browser-forum/", "/feed/tags/ca/browser-forum/index.xml"],
    ["/ms/tags/pqc/", "/ms/feed/tags/pqc/index.xml"],
  ]) {
    await page.goto(route!);
    await expect(page.locator(`link[rel="alternate"][href="${feed}"]`)).toHaveAttribute("type", "application/rss+xml");
    expect(release.files).toContain(feed!.slice(1));
    const response = await request.get(feed!);
    expect(response.ok()).toBe(true);
    const xml = await response.text();
    expect(xml).toContain("<rss");
    if (feed!.includes("bruce-morton")) expect((xml.match(/<item>/g) ?? []).length).toBe(30);
    if (feed!.startsWith("/ms/")) expect(xml).toContain("<language>ms</language>");
  }
});

test("agenda room filters support several rooms and preserve each day's selection", async ({ page }) => {
  await openPublishedAgenda(page, "/events/2026/pqc-conference-amsterdam-nl/agenda/");
  const tuesday = page.getByRole("tabpanel", { name: "Tuesday" });
  const rooms = tuesday.locator("[data-agenda-location]:not([data-agenda-location='all'])");
  const firstRoom = rooms.first();
  const secondRoom = rooms.nth(1);
  const firstId = await firstRoom.getAttribute("data-agenda-location");
  const secondId = await secondRoom.getAttribute("data-agenda-location");
  await expect(firstRoom).toHaveAttribute("aria-pressed", "true");
  await firstRoom.click();
  await expect(firstRoom).toHaveAttribute("aria-pressed", "false");
  await expect(secondRoom).toHaveAttribute("aria-pressed", "true");
  await expect(tuesday.locator(`[data-agenda-session="${firstId}"]`).first()).toBeHidden();
  await secondRoom.click();
  await expect(tuesday.locator(`[data-agenda-session="${secondId}"]`).first()).toBeHidden();
  await page.getByRole("tab", { name: "Wednesday", exact: true }).click();
  const wednesday = page.getByRole("tabpanel", { name: "Wednesday" });
  await expect(wednesday.getByRole("button", { name: "All locations", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("tab", { name: "Tuesday", exact: true }).click();
  await expect(firstRoom).toHaveAttribute("aria-pressed", "false");
  await expect(secondRoom).toHaveAttribute("aria-pressed", "false");
  await tuesday.getByRole("button", { name: "All locations", exact: true }).click();
  await expect(firstRoom).toHaveAttribute("aria-pressed", "true");
  await expect(secondRoom).toHaveAttribute("aria-pressed", "true");
  await expect(tuesday.locator(`[data-agenda-session="${firstId}"]`).first()).toBeVisible();
  await tuesday.getByRole("button", { name: "All locations", exact: true }).click();
  await expect(firstRoom).toHaveAttribute("aria-pressed", "false");
  await expect(secondRoom).toHaveAttribute("aria-pressed", "false");
});

test("historical workshop agendas use their day's eight rooms", async ({ page }) => {
  await page.goto("/events/2025/pqc-conference-kuala-lumpur-my/");
  await page.getByRole("tab", { name: "Tuesday", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Tuesday" });
  await expect(panel.locator("[data-agenda-location]:not([data-agenda-location='all'])")).toHaveCount(8);
  await expect(panel.getByRole("button", { name: "Room 8", exact: true })).toHaveAttribute("aria-pressed", "true");
  const finalRoom = panel.locator('[data-agenda-cell="room_8"] [data-agenda-session]').first();
  await finalRoom.scrollIntoViewIfNeeded();
  await expect(finalRoom).toBeVisible();
  await expect(finalRoom.getByRole("heading", { level: 3 }).first()).toHaveText(
    "Hands-On PQC Migration: From Cryptographic asset inventory to PQC Crypto-agility",
  );
});

test("published database event workflows have static pages and local form configuration", async ({ page, request }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
  });
  const route = "/events/2026/static-publication-workshop/register/";
  const response = await page.goto(route);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Event registration — Static publication workshop (synthetic)", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page.locator("[data-step-next]")).toBeEnabled();
  await page.waitForLoadState("networkidle");
  expect(apiCalls).toEqual([]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("main")).toHaveAttribute("data-pagefind-ignore", "all");
  const release = sitePublicationReleaseSchema.parse(await (await request.get("/publication.json")).json());
  expect(release.files).toContain(`${route.slice(1)}index.html`);
});

test("native static headers enforce CSP against inline scripts and styles", async ({ page }) => {
  const response = await page.goto("/members/example-corp/");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).not.toContain("'unsafe-inline'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["strict-transport-security"]).toBe("max-age=31536000");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const result = await page.evaluate(async () => {
    const violations: string[] = [];
    const listener = (event: SecurityPolicyViolationEvent) => violations.push(event.effectiveDirective);
    document.addEventListener("securitypolicyviolation", listener);
    const script = document.createElement("script");
    script.textContent = 'document.body.dataset.inlineCspTest = "executed"';
    const style = document.createElement("style");
    style.textContent = "body { outline: 123px solid red; }";
    document.head.appendChild(script);
    document.head.appendChild(style);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const result = {
      violations,
      executed: document.body.dataset.inlineCspTest,
      outline: getComputedStyle(document.body).outlineWidth,
    };
    document.removeEventListener("securitypolicyviolation", listener);
    script.remove();
    style.remove();
    return result;
  });
  expect(result.executed).toBeUndefined();
  expect(result.outline).not.toBe("123px");
  expect(result.violations).toEqual(expect.arrayContaining(["script-src-elem", "style-src-elem"]));
});

for (const path of ["/wg/pkimm/assessment/", "/wg/pkimm/1.0.0/tools/self-assessment/"]) {
  test(`the public maturity assessment at ${path} loads under the native CSP without API requests`, async ({
    page,
  }, testInfo) => {
    const violations: string[] = [];
    const apiRequests: string[] = [];
    const dependencyFailures: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400 && /(?:self-assessment\.js|\.yaml)$/.test(new URL(response.url()).pathname))
        dependencyFailures.push(response.url());
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        console.error(`PKIC_CSP_VIOLATION:${event.effectiveDirective}:${event.blockedURI}`);
      });
    });
    page.on("console", (message) => {
      if (message.text().startsWith("PKIC_CSP_VIOLATION:")) violations.push(message.text());
    });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
    });
    await page.goto(path);
    const assessment = page.locator("self-assessment");
    await page.waitForLoadState("networkidle");
    await expect(assessment.getByRole("button").first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath("assessment.png"), fullPage: true });
    expect(apiRequests).toEqual([]);
    expect(dependencyFailures).toEqual([]);
    expect(violations).toEqual([]);
  });
}

test("published diagrams render without a Mermaid download and support native keyboard zoom", async ({
  page,
  browser,
  baseURL,
}) => {
  const remoteScripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script" && new URL(request.url()).origin !== new URL(baseURL!).origin)
      remoteScripts.push(request.url());
  });
  await page.goto("/application-process/");
  const diagram = page.locator(".mermaid-wrap").first();
  await expect(diagram.locator("svg")).toBeVisible();
  const expand = diagram.getByRole("button", { name: "Expand diagram" });
  await expand.click();
  const dialog = page.getByRole("dialog", { name: "Expanded diagram" });
  await expect(dialog.locator("svg")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close diagram" })).toBeFocused();
  const dimensions = await dialog.locator("svg").evaluate((svg) => ({
    rendered: svg.getBoundingClientRect().width,
    authored: svg instanceof SVGSVGElement ? svg.viewBox.baseVal.width : 0,
  }));
  expect(dimensions.rendered).toBeCloseTo(dimensions.authored, 0);
  const viewport = dialog.getByRole("region", { name: "Scrollable diagram" });
  await viewport.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
  await expect(diagram.locator("svg")).toBeVisible();
  expect(remoteScripts).toEqual([]);
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: page.viewportSize()! });
  try {
    const plain = await context.newPage();
    await plain.goto("/wg/pqc/pqcmm/levels/");
    await expect(plain.locator(".mermaid-wrap svg").first()).toBeVisible();
    expect(await plain.locator("svg style, svg [style]").count()).toBe(0);
  } finally {
    await context.close();
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`authored diagram labels preserve contrast in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/application-process/");
    const connector = page.getByText("Yes", { exact: true }).first();
    await expect(connector).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(connector).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const diagram = page.locator(".mermaid-wrap").first();
    await expect(diagram.getByText("Added to website", { exact: true })).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(diagram.getByText("Complete application form", { exact: true })).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    await expect(diagram).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await diagram.getByRole("button", { name: "Expand diagram" }).click();
    const dialog = page.getByRole("dialog", { name: "Expanded diagram" });
    await expect(dialog.getByText("Added to website", { exact: true })).toHaveCSS("color", "rgb(0, 0, 0)");
    await page.keyboard.press("Escape");
    await page.goto("/2026/09/29/pki-maturity-model-2.0.0-new-cryptography-category-and-a-deeper-self-assessment/");
    const maturity = page.locator(".mermaid-wrap").first();
    await expect(maturity.getByText("Maturity", { exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
    const connectors = await maturity
      .locator('[data-edge="true"]')
      .evaluateAll((edges) => edges.map((edge) => getComputedStyle(edge).stroke));
    expect(connectors.length).toBeGreaterThan(0);
    expect([...new Set(connectors)]).toEqual(["rgb(107, 114, 128)"]);
    await maturity.screenshot({ path: testInfo.outputPath(`maturity-diagram-${colorScheme}.png`) });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`blog author initials have readable contrast in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/2026/09/29/pki-maturity-model-2.0.0-new-cryptography-category-and-a-deeper-self-assessment/");
    await expect(page.locator(".blog-hero-authors .pk-avatar__initials").first()).toBeVisible();
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(".blog-hero-authors", {
        runOnly: { type: "rule", values: ["color-contrast"] },
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target),
      }));
    });
    expect(violations).toEqual([]);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`event registration hero keeps white action text readable in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/events/2026/pqc-conference-amsterdam-nl/");
    const action = page.getByRole("link", { name: "Secure your seat →", exact: true });
    await expect(action).toBeVisible();
    expect(await action.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 255, 255)");
    await page.evaluate(axe.source);
    const violations = await action.evaluate(async (element) => {
      const axeWindow = window as typeof window & { axe: typeof axe };
      const result = await axeWindow.axe.run(element, { runOnly: ["color-contrast"] });
      return result.violations.map(({ id }) => id);
    });
    expect(violations).toEqual([]);
  });
}

test("blog author organization logos remain bounded and aligned with their author details", async ({ page }) => {
  await page.goto("/2026/06/08/pki-consortium-launches-the-cbom-profiles-working-group/");
  const logos = page.locator(".blog-author-org-logo");
  await expect(logos).toHaveCount(2);
  for (const logo of await logos.all()) {
    await expect(logo).toBeVisible();
    const geometry = await logo.evaluate((element) => {
      const image = element as HTMLImageElement;
      const bounds = image.getBoundingClientRect();
      const details = image.closest(".blog-author-info")!.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        left: bounds.left,
        detailsLeft: details.left,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
    });
    expect(geometry.width).toBeGreaterThan(0);
    expect(geometry.width).toBeLessThanOrEqual(100);
    expect(geometry.height).toBeGreaterThan(0);
    expect(geometry.height).toBeLessThanOrEqual(26);
    expect(Math.abs(geometry.left - geometry.detailsLeft)).toBeLessThan(1);
    expect(geometry.width / geometry.height).toBeCloseTo(geometry.naturalWidth / geometry.naturalHeight, 1);
  }
});

test("agenda compact and expanded views preserve tabs and session details", async ({ page }) => {
  await openPublishedAgenda(page, "/events/2026/pqc-conference-amsterdam-nl/agenda/");
  const agenda = page.getByRole("region", { name: "Event agenda" });
  const description = agenda.locator(".pk-content-agenda__description").filter({ visible: true }).first();
  await expect(description).toBeVisible();
  const compact = agenda.getByRole("button", { name: "Compact agenda", exact: true });
  await expect(compact.locator("svg")).toHaveCount(1);
  await expect(compact).toHaveText("");
  await compact.click();
  await expect(compact).toHaveAttribute("aria-pressed", "true");
  await expect(description).toBeHidden();
  await agenda
    .getByRole("link", { name: /^Open session details:/ })
    .or(agenda.getByRole("button", { name: /^Open session details:/ }))
    .first()
    .click();
  const session = page.getByRole("dialog").filter({ visible: true });
  await expect(session.getByRole("heading", { name: "Abstract", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const selected = agenda.getByRole("tab").nth(1);
  await selected.click();
  const expand = agenda.getByRole("button", { name: "Expand agenda", exact: true });
  await expand.click();
  const expanded = page.getByRole("dialog", { name: "Expanded event agenda" });
  await expect(expanded).toBeVisible();
  const exit = expanded.getByRole("button", { name: "Exit fullscreen", exact: true });
  await expect(exit).toBeFocused();
  await expect(exit).toHaveText("");
  await expect(exit.locator("svg")).toHaveCount(1);
  if (page.viewportSize()!.width < 736) {
    const bounds = await expanded.boundingBox();
    expect(bounds!.x).toBeLessThanOrEqual(1);
    expect(bounds!.y).toBeLessThanOrEqual(1);
    expect(bounds!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
    expect(bounds!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);
  }
  await expanded.evaluate((element) => {
    element.scrollTop = 500;
  });
  await expect(exit).toBeInViewport();
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(compact).toHaveAttribute("aria-pressed", "true");
  await exit.click();
  await expect(expanded).toBeHidden();
  await expect(expand).toBeFocused();
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await compact.click();
  await expect(compact).toHaveAttribute("aria-pressed", "false");
  await expect(agenda.locator(".pk-content-agenda__description").filter({ visible: true }).first()).toBeVisible();
});

test("historical agenda integrates recording, slide downloads, and moderator roles", async ({ page, request }) => {
  await openPublishedAgenda(page, "/events/2025/pqc-conference-kuala-lumpur-my/");
  await page.getByRole("tab", { name: "Wednesday", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Wednesday" });
  const opening = panel
    .locator(".pk-content-agenda__session")
    .filter({
      has: page.getByRole("heading", { name: "Opening", exact: true }),
    })
    .first();
  const slides = opening.getByRole("link", { name: "Download slides", exact: true });
  await expect(slides).toBeVisible();
  const pdf = await request.get((await slides.getAttribute("href"))!);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(panel.getByText("Moderator", { exact: true }).first()).toBeVisible();
  const recording = panel.getByRole("link", { name: "Watch recording", exact: true }).first();
  await expect(recording).toHaveAttribute("href", /^https:\/\//);
  await expect(recording).toHaveAttribute("data-agenda-watch-recording", "true");
  const recordingDialog = await recording.getAttribute("data-agenda-open-session");
  expect(recordingDialog).toBeTruthy();
  await expect(page.locator(`dialog[id="${recordingDialog}"]`)).toHaveCount(1);
  await recording.click();
  await expect(page.locator(`dialog[id="${recordingDialog}"]`)).toBeVisible();
  await expect(page.locator("dialog[open] iframe")).toHaveAttribute("src", /youtube-nocookie\.com/);
  const recordingBox = (await page.locator("dialog[open] iframe").boundingBox())!;
  expect(recordingBox.height).toBeGreaterThan(100);
  expect(Math.abs(recordingBox.width / recordingBox.height - 16 / 9)).toBeLessThan(0.03);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  if (page.viewportSize()!.width < 736) {
    expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("conference speaker-card variants preserve legacy aliases and render without inline styles", async ({
  page,
}, testInfo) => {
  const route = "/events/2025/pqc-conference-kuala-lumpur-my/";
  const data = await page.request.get(`${route}event-data.json`);
  expect(data.status()).toBe(200);
  const program = await data.json();
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  for (const variant of ["event-speakers", "event-speakers2"]) {
    const response = await page.goto(`${route}${variant}.html#speaker=1`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("#speaker-name")).toHaveText(program.speakers[0].name);
    await expect(page.locator(".speaker-card-event-info")).toContainText(program.name);
    expect(await page.locator("[style]").count()).toBe(0);
    const image = page.locator("#speaker-photo img");
    if (program.speakers[0].headshot) {
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
        .toBe(true);
    }
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#speaker-name")).toHaveText(program.speakers[1].name);
    await page.screenshot({ path: testInfo.outputPath(`${variant}.png`), fullPage: true });
    const sitemap = await page.request.get("/sitemap-0.xml");
    expect(await sitemap.text()).not.toContain(`${route}${variant}/`);
  }
  expect(violations).toEqual([]);
});

test("historical Kuala Lumpur session display preserves sponsors and presentation controls", async ({
  page,
}, testInfo) => {
  const route = "/events/2025/pqc-conference-kuala-lumpur-my/";
  const data = await page.request.get(`${route}event-data.json`);
  const program = await data.json();
  const date = Object.keys(program.agenda)[0];
  const slot = program.agenda[date].find((entry: { sessions: unknown[] }) => entry.sessions.length > 1);
  const parameters = new URLSearchParams({ day: date, time: slot.time, layout: "panel" });
  const apiRequests: string[] = [];
  const violations: string[] = [];
  await page.route("**/api/**", async (request) => {
    apiRequests.push(request.request().url());
    await request.abort();
  });
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  const response = await page.goto(`${route}event-session.html#${parameters}`);
  expect(response?.status()).toBe(200);
  expect(await response!.text()).toContain("Kiosk verification sponsor");
  await expect(page.getByRole("img", { name: /Kiosk verification sponsor/ })).toBeVisible();
  await expect(page.locator("#title")).toHaveText(slot.sessions[0].title);
  await expect(page.locator(".headshot-container").first()).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#title")).toHaveText(slot.sessions[1].title);
  await expect(page.locator("#description")).not.toContainText("**");
  await page.keyboard.press("+");
  await expect(page.locator("#footer")).toBeHidden();
  await page.keyboard.press("-");
  await expect(page.locator("#footer")).toBeVisible();
  const logo = await page.locator("#logo").boundingBox();
  expect(logo!.height).toBeLessThan(60);
  await page.screenshot({ path: testInfo.outputPath("conference-kiosk.png"), fullPage: true });
  parameters.set("clean", "true");
  parameters.set("showTitle", "true");
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, parameters.toString());
  await expect(page.locator("#header")).toBeHidden();
  await expect(page.locator("#title")).toBeVisible();
  expect(await page.locator("[style]").count()).toBe(0);
  expect(apiRequests).toEqual([]);
  expect(violations).toEqual([]);
});

test("conference broadcast overlays preserve speaker selection and diagnostic controls under CSP", async ({
  page,
}, testInfo) => {
  const route = "/events/2025/pqc-conference-kuala-lumpur-my/";
  const program = await (await page.request.get(`${route}event-data.json`)).json();
  const speaker = program.speakers[0];
  const date = Object.keys(program.agenda)[0];
  const slot = program.agenda[date].find((entry: { sessions: { speakers: string[] }[] }) =>
    entry.sessions.some((session) => session.speakers.length > 1),
  );
  const apiRequests: string[] = [];
  const violations: string[] = [];
  await page.route("**/api/**", async (request) => {
    apiRequests.push(request.request().url());
    await request.abort();
  });
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  const response = await page.goto(
    `${route}event-overlays.html#${new URLSearchParams({ day: date, time: slot.time, debug: "true" })}`,
  );
  expect(response?.status()).toBe(200);
  await expect(page.locator("#Name tspan")).not.toHaveText("No speaker scheduled");
  await expect(page.locator("#debug-overlay")).toContainText("View mode: CURRENT");
  const name = await page.locator("#Name tspan").textContent();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#Name tspan")).not.toHaveText(name!);
  const allMode = (await page.locator("#debug-overlay").textContent())!.includes("View mode: ALL");
  await page.keyboard.press(" ");
  await expect(page.locator("#debug-overlay")).toContainText(`View mode: ${allMode ? "CURRENT" : "ALL"}`);
  expect(await page.locator("[style], style").count()).toBe(0);
  expect(apiRequests).toEqual([]);
  expect(violations).toEqual([]);
  await page.evaluate(
    (hash) => {
      window.location.hash = hash;
    },
    new URLSearchParams({ name: speaker.name }).toString(),
  );
  await expect(page.locator("#debug-overlay")).toHaveCount(0);
  await expect(page.locator("#Name tspan")).toHaveText(speaker.name);
  await page.screenshot({ path: testInfo.outputPath("conference-overlays.png"), fullPage: true });
});

test("proposal agreements show rejected and accepted states beside a primary Continue action", async ({ page }) => {
  await page.goto("/events/2026/pqc-conference-amsterdam-nl/propose/");
  const form = page.locator("[data-event-proposal] form");
  const terms = form.locator("[data-consent-input][required]");
  await expect(terms.first()).toBeVisible();
  const next = form.getByRole("button", { name: "Continue →", exact: true });
  await expect(next).toHaveClass(/pk-btn--primary/);
  const card = form
    .locator("[data-term-key]")
    .filter({ has: page.locator("[data-consent-input][required]") })
    .first();
  const body = card.locator(".pk-panel__body");
  const neutralBackground = await body.evaluate((element) => getComputedStyle(element).backgroundColor);
  await next.click();
  await expect(terms.first()).toHaveAttribute("aria-invalid", "true");
  await expect(body).not.toHaveCSS("background-color", neutralBackground);
  const invalidBackground = await body.evaluate((element) => getComputedStyle(element).backgroundColor);
  await terms.first().check();
  await expect(body).not.toHaveCSS("background-color", invalidBackground);
  await expect(card.locator(".pk-panel__body--ok")).toBeVisible();
});

test("sticky section navigation meets the navbar without a transparent gap", async ({ page }) => {
  for (const path of ["/wg/pkimm/", "/events/2026/pqc-conference-amsterdam-nl/"]) {
    await page.goto(path);
    const navbar = page.getByRole("navigation", { name: "Main", exact: true });
    const sections = page.locator(".wg-section-nav, .pk-section-navigation");
    await expect(sections).toBeVisible();
    await sections.evaluate((element) =>
      window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top + 100),
    );
    await expect
      .poll(async () => {
        const header = await navbar.boundingBox();
        const submenu = await sections.boundingBox();
        return Math.abs(submenu!.y - header!.y - header!.height);
      })
      .toBeLessThanOrEqual(0.5);
  }
});

test("homepage information callout has breathing room below the hero statistics", async ({ page }) => {
  await page.goto("/");
  const statistics = page.locator(".pkic-stats-bar");
  const callout = page.locator(".pkic-home-content .pk-content-alert").first();
  await expect(callout).toBeVisible();
  const strip = await statistics.boundingBox();
  const notice = await callout.boundingBox();
  expect(notice!.y - strip!.y - strip!.height).toBeGreaterThanOrEqual(24);
});
