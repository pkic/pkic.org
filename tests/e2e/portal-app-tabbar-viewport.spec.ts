import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

test("mobile event navigation follows viewport growth and shrinkage while keeping its actual height visible", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 640 });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/agenda");
  const bar = page.locator(".pk-app-tabbar--event");
  await expect(bar).toBeVisible();
  for (const height of [640, 844, 568, 932, 640]) {
    await page.setViewportSize({ width: 390, height });
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect
      .poll(() =>
        bar.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return Math.abs(box.bottom - document.documentElement.clientHeight);
        }),
      )
      .toBeLessThanOrEqual(1);
    const geometry = await bar.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        padding: Number.parseFloat(getComputedStyle(element).paddingBottom),
        controls: [...element.querySelectorAll("a, button")].map((control) => {
          const bounds = control.getBoundingClientRect();
          return { top: bounds.top, bottom: bounds.bottom };
        }),
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom - geometry.top).toBeCloseTo(geometry.height);
    expect(geometry.padding).toBeGreaterThanOrEqual(0);
    for (const control of geometry.controls) {
      expect(control.top).toBeGreaterThanOrEqual(geometry.top);
      expect(control.bottom).toBeLessThanOrEqual(geometry.bottom - geometry.padding);
    }
    await expect(
      page
        .getByRole("navigation", { name: "Event app", exact: true })
        .getByRole("link", { name: "Agenda", exact: true }),
    ).toBeVisible();
    if (height === 844 || height === 568)
      await page.screenshot({ path: info.outputPath(`event-navigation-height-${height}.png`) });
  }
});

test("phone chrome stays on the visible area when the browser leaves it offset in the layout viewport", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Mobile Safari can keep the visible area 72px down the layout viewport after its toolbar collapses or the
  // keyboard closes, so chrome placed against the layout viewport slips under its bar and lifts off the bottom.
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      offsetTop: { get: () => 72 },
      height: { get: () => window.innerHeight },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => viewport });
  });
  await page.setViewportSize({ width: 390, height: 664 });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.goto("/portal/#/home");
  const bar = page.locator(".pk-app-tabbar--portal");
  await expect(bar).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 200));
  const geometry = await page.evaluate(() => ({
    header: document.querySelector(".pkic-navbar")!.getBoundingClientRect().top,
    topbar: document.getElementById("portal-topbar")!.getBoundingClientRect().top,
    bar: document.querySelector(".pk-app-tabbar--portal")!.getBoundingClientRect().bottom,
    height: window.innerHeight,
  }));
  expect(geometry.header).toBeCloseTo(72, 0);
  expect(geometry.topbar).toBeGreaterThanOrEqual(72);
  // The visible area ends 72px below the layout viewport's edge, so the bar sits there rather than above it.
  expect(geometry.bar).toBeCloseTo(geometry.height + 72, 0);

  // A screen with a bottom bar of its own (the studio's panel tabs) owns the bottom edge.
  await page
    .locator("#portal-main")
    .evaluate((main) => main.insertAdjacentHTML("beforeend", '<nav data-app-bottom-bar=""></nav>'));
  await expect(bar).toBeHidden();
});
