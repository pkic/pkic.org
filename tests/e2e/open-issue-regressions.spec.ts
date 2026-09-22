/** Open production-readiness regressions #171, #172, #175, #182, #186. @covers presentation.13.7 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { memberWallResponseSchema } from "../../assets/shared/schemas/members-directory";

test("registration shows completion marks only for completed steps and uses the available width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
  const checks = page.locator(".event-flow-stepper-check");
  await expect(checks).toHaveCount(4);
  for (const check of await checks.all()) await expect(check).toBeHidden();
  const form = page.locator("[data-event-registration] form");
  await expect(form).toBeVisible();
  expect((await form.boundingBox())!.width).toBeGreaterThan(800);
  await page.screenshot({ path: test.info().outputPath("registration.png"), fullPage: true });
});

test("donation columns and callout stay readable at desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/donate/");
  const form = page.locator("[data-donation-form]");
  const text = page.getByRole("heading", { name: "The real cost of “free”" });
  const formBox = await form.boundingBox();
  const textBox = await text.boundingBox();
  expect(formBox!.x).toBeGreaterThan(textBox!.x + textBox!.width);
  const callout = page.locator(".pk-alert--callout");
  await expect(callout).toBeVisible();
  expect(await callout.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("linear-gradient");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const contrasts = await callout.evaluate((el) => {
      const context = document.createElement("canvas").getContext("2d")!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      };
      const style = getComputedStyle(el);
      const foreground = luminance(style.color);
      return [...style.backgroundImage.matchAll(/(?:rgba?|color)\([^()]+\)/g)].map(([color]) => {
        const background = luminance(color);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });
    expect(contrasts).toHaveLength(2);
    for (const contrast of contrasts) expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({ path: test.info().outputPath("donate-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await form.boundingBox())!.y).toBeGreaterThan((await text.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("dark homepage titles use readable ink and navigation emits no unload warning", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/api/v1/members/wall*", (route) =>
    route.fulfill({
      json: memberWallResponseSchema.parse({
        entries: [0, 1].map((sponsorLevel) => ({
          key: `synthetic-${sponsorLevel}`,
          href: "/members/",
          logoUrl: "/synthetic-member-logo.svg",
          name: "Synthetic member",
          slogan: null,
          sponsorLevel,
          sponsorLevelName: sponsorLevel ? "Sponsor" : null,
        })),
      }),
    }),
  );
  await page.route("**/synthetic-member-logo.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="36"><text x="0" y="27" fill="black" font-size="24">Member</text></svg>',
    }),
  );
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (/permissions.policy.*unload/i.test(message.text())) warnings.push(message.text());
  });
  await page.goto("/");
  const titles = page.locator(".pkic-wg-spotlight-body h3, .blog-card-summary, .blog-author-avatars-names");
  await expect(titles.first()).toBeVisible();
  const logo = page.locator('.members-overview img[alt="Synthetic member"]').first();
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor))
    .toBe("rgb(255, 255, 255)");
  expect(await logo.evaluate((el) => getComputedStyle(el).filter)).not.toMatch(/opacity|contrast/);
  const colors = await titles.evaluateAll((elements) =>
    elements.map((el) => {
      const style = getComputedStyle(el);
      return { foreground: style.color, ink: style.getPropertyValue("--pk-ink").trim() };
    }),
  );
  // Resolve the token through the browser to avoid comparing CSS color syntaxes.
  for (const title of await titles.all()) {
    const contrast = await title.evaluate((el) => {
      const luminance = (value: string) => {
        const channels = value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const fg = luminance(getComputedStyle(el).color);
      const bg = luminance(getComputedStyle(el.closest(".pkic-wg-spotlight, .blog-card")!).backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(contrast, JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
  }
  await page.screenshot({ path: test.info().outputPath("home-dark.png"), fullPage: true });
  const sectionHeading = page.getByRole("heading", { name: "Working Groups", exact: true });
  for (const explicit of [false, true]) {
    if (explicit) {
      await page.emulateMedia({ colorScheme: "light" });
      await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    }
    expect(await sectionHeading.evaluate((el) => getComputedStyle(el).webkitTextFillColor)).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(await sectionHeading.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
  }
  await page.goto("/about/");
  expect(warnings).toEqual([]);
});

test("staff can create and search for a user and table settings do not cover the final heading", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-user-create"));
  await page.goto("/portal/#/users");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  const email = `created-${Date.now()}@example.test`;
  await page.getByRole("textbox", { name: "Email address (required)", exact: true }).fill(email);
  await page.getByLabel("First name", { exact: true }).fill("Created");
  await page.getByLabel("Last name", { exact: true }).fill("Person");
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Created Person" })).toBeVisible();
  await page.goto("/portal/#/users");
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.getByRole("searchbox").fill(email);
  await page.getByRole("searchbox").press("Enter");
  await expect(page.getByRole("row").filter({ hasText: "Created Person" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("users-table.png") });
  await page.goto("/portal/#/settings/application-workflow");
  await expect(page.getByRole("columnheader", { name: /Required steps/ })).toBeVisible();
  const settings = page.getByRole("button", { name: "Choose columns", exact: true });
  await expect(settings).toBeVisible();
  const heading = page.locator("th").filter({ has: settings });
  const content = heading.locator(".pk-table__head-content");
  await expect(content).toContainText("Required steps");
  const overlaps = await content.evaluate((el) => {
    const children = [...el.children].map((child) => child.getBoundingClientRect()).filter((rect) => rect.width > 0);
    return children.some((rect, index) => index > 0 && rect.left < children[index - 1].right);
  });
  expect(overlaps).toBe(false);
  await page.screenshot({ path: test.info().outputPath("workflow-table.png") });
  const membership = page.locator("#portal-sidebar details").filter({ hasText: "Membership" });
  await expect(membership.locator("summary")).toHaveText("Membership");
  await expect(membership.getByRole("link")).toHaveCount(4);
  await membership.locator("summary").click();
  await expect(membership.getByRole("link").first()).toBeHidden();
  await page.goto("/portal/#/donations");
  await expect(page.getByRole("searchbox", { name: "Search donations", exact: true })).toBeVisible();
  await page.goto("/portal/#/forms");
  const controls = page.getByRole("toolbar", { name: "Configured forms controls" });
  const create = controls.getByRole("button", { name: "New form", exact: true });
  await expect(create).toBeVisible();
  expect(
    Math.abs((await create.boundingBox())!.height - (await controls.getByRole("searchbox").boundingBox())!.height),
  ).toBeLessThanOrEqual(1);
});
