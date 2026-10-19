/**
 * The portal on a phone, a tablet and a desktop.
 *
 * The design-system preview proves the primitives behave. This proves the
 * screens built from them do — which is a different question, because a screen
 * is where a wide table meets a narrow column meets a sidebar that has to get
 * out of the way.
 *
 * These are checked on every screen at every width, and each of them is a
 * defect this repository has actually shipped:
 *
 *   - Nothing pushes the page sideways. A single unclipped element does it,
 *     and once it happens every screen on the site scrolls horizontally.
 *   - Nothing is operable by mouse only. An onClick on a div, a span or a
 *     table row type-checks, lints, renders, and strands anyone using a
 *     keyboard. Fourteen portal lists were built that way.
 *   - Every table has a name, every icon-only control has a name, and every
 *     form control resolves to a label. An unnamed control is invisible to
 *     anyone who is not looking at it.
 *   - A button is as wide as its label and never touches the next one: a
 *     stretched or crowded command reads as part of the layout, not an action.
 *   - Button text stays readable on its own background, in the light and the
 *     dark theme alike.
 * @covers presentation.13.4
 */

import { expect, test } from "@playwright/test";

import { e2eAdminEmail } from "../helpers/e2e-admin";
import { eventScreens, prepareEventAppScreens, settleScreen } from "./helpers/event-app-screens-fixture";
import { screenProblems } from "./helpers/responsive-probes";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

/** The portal screens that are migrated and worth holding to this standard. */
const SCREENS = [
  { name: "home", path: "#/" },
  // The person's record replaced the separate profile page; this session is
  // staff, so the directory is the screen it can open without knowing an id.
  { name: "users", path: "#/users" },
  { name: "own-user-record", path: "#/users/current" },
  { name: "groups", path: "#/groups" },
  { name: "organizations", path: "#/organizations" },
  { name: "events", path: "#/events" },
  { name: "forms", path: "#/forms" },
  { name: "donations", path: "#/donations" },
  { name: "groups-new", path: "#/groups/new" },
  // The seeded Post-Quantum Cryptography working group (by its identifier) and
  // the Board (by its slug) are addressable without a record this sweep would
  // have to create, so a group's own workspace is walked as well.
  { name: "group-mailing-lists", path: "#/groups/20000000-0000-4000-8000-000000000003/mailing-lists" },
  { name: "group-settings", path: "#/groups/20000000-0000-4000-8000-000000000003/settings" },
  { name: "group-leadership", path: "#/groups/board/leadership" },
  { name: "group-leadership-add", path: "#/groups/board/leadership/add" },
  { name: "members", path: "#/members" },
  { name: "members-grant", path: "#/members/grant" },
  { name: "members-analytics", path: "#/members/analytics" },
  { name: "access-control", path: "#/settings/access-control" },
  { name: "audit-log", path: "#/settings/audit-log" },
  { name: "email-outbox", path: "#/settings/email-outbox" },
  { name: "email-templates", path: "#/settings/email-templates" },
  { name: "scheduled-jobs", path: "#/settings/scheduled-jobs" },
] as const;

/*
 * One sign-in, every width.
 *
 * Each sign-in issues a magic link and redeems it, and the portal rate-limits
 * that per client address. Four tests that each sign in as the same operator
 * exhaust the limiter and the later ones never get a session — so this walks
 * all three widths inside one test rather than paying for three sessions to
 * assert the same thing.
 */
test.describe("portal at every width", () => {
  test("is usable at mobile, tablet and desktop", async ({ page }) => {
    await signInAsE2eStaff(page, e2eAdminEmail("portal-responsive-widths"));

    const failures: string[] = [];

    for (const viewport of WIDTHS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const screen of SCREENS) {
        await page.emulateMedia({ colorScheme: "light" });
        await page.goto(`/portal/${screen.path}`);
        await expect(page.locator("#portal-root")).toBeVisible();
        // The section renders into a lazy chunk; wait for content, not a timer.
        await page.waitForLoadState("networkidle");

        failures.push(...(await screenProblems(page, `${viewport.name}/${screen.name}`)));

        await page.screenshot({
          path: `test-results/portal-${screen.name}-${viewport.name}.png`,
          fullPage: true,
        });
      }
    }

    expect(failures, "portal problems across widths").toEqual([]);
  });

  test("is usable on a phone and a desktop across the event app and its management", async ({ page, browser }) => {
    // Two widths, two themes and some thirty screens: the walk, not any one screen, takes the time.
    test.setTimeout(1_200_000);
    const email = e2eAdminEmail("portal-responsive-events");
    await signInAsE2eStaff(page, email);
    // The player is a third-party frame; its box in the layout is under test, not YouTube.
    await page.route(/youtube(-nocookie)?\.com/, (route) => route.abort());
    const screens = eventScreens(await prepareEventAppScreens(page, email));

    const failures: string[] = [];
    for (const viewport of WIDTHS.filter((width) => width.name !== "tablet")) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const screen of screens) {
        if (screen.canvas && viewport.name !== "desktop") continue;
        await page.setViewportSize(screen.canvas ?? { width: viewport.width, height: viewport.height });
        await page.emulateMedia({ colorScheme: "light" });
        // A fresh document each time: an open dialog or a full-screen scanner must not carry over.
        await page.goto("about:blank");
        await page.goto(screen.path);
        if (screen.path.startsWith("/portal/")) await expect(page.locator("#portal-root")).toBeVisible();
        const where = `${viewport.name}/${screen.name}`;
        try {
          await settleScreen(page);
          if (screen.open) await screen.open(page);
        } catch (error) {
          // A screen that never finishes loading is itself the finding; the walk goes on.
          failures.push(`${where}: did not finish loading — ${(error as Error).message.split("\n")[0]}`);
        }

        failures.push(...(await screenProblems(page, where)));
        await page.screenshot({ path: `test-results/portal-${screen.name}-${viewport.name}.png`, fullPage: true });
      }
    }

    // The sign-in screen a registrant lands on from the event app, without a session.
    const signedOut = await browser.newPage();
    for (const viewport of WIDTHS.filter((width) => width.name !== "tablet")) {
      await signedOut.setViewportSize({ width: viewport.width, height: viewport.height });
      await signedOut.goto("/portal/");
      await expect(signedOut.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
      failures.push(...(await screenProblems(signedOut, `${viewport.name}/login`)));
      await signedOut.screenshot({ path: `test-results/portal-login-${viewport.name}.png`, fullPage: true });
    }
    await signedOut.close();

    expect(failures, "event app problems across widths").toEqual([]);
  });

  test("opens and closes its navigation on a phone, and returns focus", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAsE2eStaff(page, e2eAdminEmail("portal-responsive-navigation"));

    const toggle = page.locator("#portal-sidebar-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#portal-sidebar")).toHaveClass(/open/);

    // Escape closes it and puts focus back on the control that opened it,
    // rather than leaving a keyboard user somewhere behind the panel.
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  });
});
