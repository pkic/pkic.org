/**
 * Portal navigation at a narrow viewport.
 *
 * No browser journey set a mobile viewport at all, so the drawer — its toggle,
 * backdrop, Escape handling, and focus restoration — was only ever exercised
 * in its desktop layout, where the sidebar is always visible and none of that
 * behavior runs. These are the paths a keyboard or screen-reader user depends
 * on, and they fail silently for everyone else.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const MOBILE = { width: 390, height: 844 };
/**
 * One sign-in for the whole file. Each test signing in separately would send
 * four sign-in links to the same address in seconds and trip the per-identity
 * rate limiter, which the scoped identities exist to stay clear of.
 */
const AUTH_FILE = path.join("test-results", "portal-mobile-navigation-auth.json");

test.describe("portal navigation on a narrow viewport", () => {
  test.beforeAll(async ({ browser }) => {
    if (existsSync(AUTH_FILE)) return;
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await signInToPortal(page, e2eAdminEmail("portal-mobile-navigation"));
    await context.storageState({ path: AUTH_FILE });
    await context.close();
  });

  test.use({ storageState: AUTH_FILE });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/portal/");
    await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });
  });

  test("the drawer opens, closes on Escape, and returns focus to its toggle", async ({ page }) => {
    const toggle = page.locator("#portal-sidebar-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#portal-sidebar")).toHaveClass(/open/);

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#portal-sidebar")).not.toHaveClass(/open/);

    // Focus must come back to the control that opened the drawer, or a
    // keyboard user is stranded at the top of the document.
    await expect(toggle).toBeFocused();
  });

  test("the backdrop closes the drawer", async ({ page }) => {
    const toggle = page.locator("#portal-sidebar-toggle");
    await toggle.click();
    await expect(page.locator("#portal-sidebar")).toHaveClass(/open/);

    await page.locator("#portal-sidebar-backdrop").click();
    await expect(page.locator("#portal-sidebar")).not.toHaveClass(/open/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the toggle is reachable and operable from the keyboard alone", async ({ page }) => {
    const toggle = page.locator("#portal-sidebar-toggle");
    await toggle.focus();
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#portal-sidebar")).toHaveClass(/open/);

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the narrow drawer exposes the same authorized destinations as the desktop sidebar", async ({ page }) => {
    const toggle = page.locator("#portal-sidebar-toggle");
    await toggle.click();
    const mobileLinks = await page
      .locator("#portal-sidebar a")
      .evaluateAll((links) => links.map((link) => (link.textContent ?? "").trim()).filter(Boolean));
    expect(mobileLinks.length, "the drawer must render navigation").toBeGreaterThan(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    const desktopLinks = await page
      .locator("#portal-sidebar a")
      .evaluateAll((links) => links.map((link) => (link.textContent ?? "").trim()).filter(Boolean));

    // A narrow layout must not quietly drop or add destinations: the
    // capability set is the same identity either way.
    expect(new Set(mobileLinks)).toEqual(new Set(desktopLinks));
  });
});
