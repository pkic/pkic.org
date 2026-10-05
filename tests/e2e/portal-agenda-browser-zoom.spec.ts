import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { initialsFrom } from "../../assets/ts/shared/initials";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { matrixTitle, prepareAgendaInteractionFixture } from "./helpers/agenda-interaction-fixture";
import { captureBrowserZoomViewport, openBrowserZoomContext, setBrowserZoom } from "./helpers/browser-zoom";

async function activate(control: Locator) {
  await expect(control).toBeVisible();
  await control.focus();
  await control.press("Enter");
}

async function captureAtTop(page: Page, path: string) {
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await captureViewport(page, path);
}

async function captureViewport(page: Page, path: string) {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  const pixels = await captureBrowserZoomViewport(page, path);
  expect(pixels.width).toBeCloseTo(viewport.width * viewport.dpr, 0);
  // innerHeight is an integer CSS measurement; the surface can retain its fractional pixel row.
  expect(Math.abs(pixels.height - viewport.height * viewport.dpr)).toBeLessThanOrEqual(viewport.dpr - 1);
}

test("actual 200% browser zoom preserves long-panel reading and keyboard access across three rooms", async ({
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Canonical local E2E base URL is required");
  const { context, worker } = await openBrowserZoomContext(info.outputPath("browser-zoom"), baseURL);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const cspViolations: string[] = [];
    page.on("console", (message) => {
      if (message.text().startsWith("AGENDA_CSP_VIOLATION:")) cspViolations.push(message.text());
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        console.error(`AGENDA_CSP_VIOLATION:${event.effectiveDirective}`);
      });
    });
    const portalResponse = page.waitForResponse(
      (response) => response.request().isNavigationRequest() && new URL(response.url()).pathname === "/portal/",
    );
    await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-publication-layout"));
    const response = await portalResponse;
    expect(response.status()).toBe(200);
    const policy = response.headers()["content-security-policy"];
    expect(policy).toBeDefined();
    expect(policy).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("style-src-attr 'none'");
    const fixture = await prepareAgendaInteractionFixture(page);
    await page.goto(`/portal/#/events/${fixture.slug}/agenda`);
    await expect(page.getByRole("heading", { name: matrixTitle, exact: true })).toBeVisible();
    const baseline = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
    expect(baseline.width).toBeGreaterThanOrEqual(1000);
    const zoom = await setBrowserZoom(worker, page, 2);
    expect(zoom.factor).toBe(2);
    expect(zoom.settings).toMatchObject({ mode: "automatic", scope: "per-tab" });
    await expect
      .poll(() => page.evaluate((width) => Math.abs(innerWidth * 2 - width), baseline.width))
      .toBeLessThanOrEqual(2);
    const rendered = await page.evaluate(() => ({
      width: innerWidth,
      dpr: devicePixelRatio,
      pinchScale: visualViewport?.scale,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(rendered.dpr).toBeCloseTo(baseline.dpr * 2, 2);
    expect(rendered.pinchScale).toBe(1);
    expect(rendered.documentWidth).toBeLessThanOrEqual(rendered.width + 1);
    await writeFile(
      info.outputPath("browser-zoom-receipt.json"),
      JSON.stringify({ baseline, zoom, rendered }, null, 2),
    );
    await captureAtTop(page, info.outputPath("agenda-browser-zoom-200-viewport.png"));
    const sessionHeading = page.getByRole("heading", { name: matrixTitle, exact: true });
    await sessionHeading.scrollIntoViewIfNeeded();
    await expect(sessionHeading).toBeInViewport({ ratio: 1 });
    await captureViewport(page, info.outputPath("agenda-board-browser-zoom-200-viewport.png"));

    await activate(page.getByRole("button", { name: `Open session details: ${matrixTitle}`, exact: true }));
    const panel = page.getByRole("dialog", { name: matrixTitle, exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Moderator", { exact: true })).toBeVisible();
    for (const person of fixture.people) {
      const speaker = panel.getByRole("article").filter({
        has: page.getByRole("heading", { name: person.name, exact: true }),
      });
      await expect(speaker.getByText(initialsFrom(person.name), { exact: true })).toBeVisible();
      await expect(speaker.locator("img")).toHaveCount(0);
    }
    const bounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: innerWidth,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        headings: [...element.querySelectorAll("h2,h3")].map((heading) => {
          const box = heading.getBoundingClientRect();
          return { left: box.left, right: box.right };
        }),
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
    for (const heading of bounds.headings) {
      expect(heading.left).toBeGreaterThanOrEqual(bounds.left - 1);
      expect(heading.right).toBeLessThanOrEqual(bounds.right + 1);
    }
    await captureAtTop(page, info.outputPath("long-panel-browser-zoom-200-viewport.png"));
    for (const [index, person] of fixture.people.entries()) {
      const heading = panel.getByRole("heading", { name: person.name, exact: true });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeInViewport({ ratio: 1 });
      await captureAtTop(page, info.outputPath(`panel-speaker-${index + 1}-browser-zoom-200-viewport.png`));
    }
    await activate(panel.getByRole("button", { name: "Close session details", exact: true }));
    await expect(panel).toBeHidden();
    const before = await fixture.read();
    await activate(page.getByRole("button", { name: `Resize ${matrixTitle} by dragging to an end time`, exact: true }));
    for (const room of ["Main auditorium", "Workshop room", "Community discussion room"])
      await expect(
        page.getByRole("button", { name: new RegExp(`^End selected session at .* in ${room}$`) }).first(),
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /End selected session at .* in Workshop room$/ }).first(),
    ).toBeDisabled();
    await activate(page.getByRole("button", { name: "Cancel selection", exact: true }));
    expect(await fixture.read()).toEqual(before);
    await expect(page.getByRole("button", { name: /^End selected session at/ })).toHaveCount(0);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    expect(cspViolations).toEqual([]);
  } finally {
    await context.close();
  }
});
