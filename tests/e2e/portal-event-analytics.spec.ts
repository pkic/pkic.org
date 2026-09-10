/**
 * @covers system.12.3
 * @covers system.12.3.a
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("permitted staff reach event analytics under the events they measure", async ({ page }) => {
  const analyticsRequests: string[] = [];
  const retiredSystemRequests: string[] = [];
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/analytics/")) analyticsRequests.push(pathname);
    if (pathname.startsWith("/api/v1/system/analytics/")) retiredSystemRequests.push(pathname);
    if (pathname === "/api/v1/admin/stats") legacyRequests.push(pathname);
  });

  await signInToPortal(page, e2eAdminEmail("portal-analytics"));
  await page.goto("/portal/#/events/analytics");
  // A page of its own under the domain it measures, so it heads itself.
  await expect(page.getByRole("heading", { name: "Event analytics" })).toBeVisible();
  await expect(page.getByText("Total Registrations", { exact: true })).toBeVisible();
  // Each analytics card is a Panel now, so its title is a real heading. The
  // period tables carry the same wording as their panel's title, so locating
  // by role rather than by text keeps this to the one element it means.
  await expect(page.getByRole("heading", { name: "Top Events", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Registrations", exact: true }).last().click();
  await expect(page).toHaveURL(/\/portal\/#\/events\/analytics\/registrations$/);
  await expect(
    page.getByRole("heading", { name: "Registrations — Weekly (last 12 weeks)", exact: true }),
  ).toBeVisible();

  // Donation analytics now live under Donations → Analytics, not here — this
  // strip only offers Overview and Registrations.
  await expect(page.getByRole("navigation", { name: "Event analytics" }).getByText("Donations")).toHaveCount(0);

  await page.goto("/portal/#/events/analytics");
  await expect(page).toHaveURL(/\/portal\/#\/events\/analytics$/);
  await expect(page.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");

  expect(analyticsRequests).toEqual(
    expect.arrayContaining(["/api/v1/analytics/summary", "/api/v1/analytics/registrations"]),
  );
  expect(retiredSystemRequests).toEqual([]);
  expect(legacyRequests).toEqual([]);
});

/**
 * #39: the figures live under the domain they measure.
 *
 * Reached the way the reader does — from each section's own sidebar entry,
 * not by typing the address — because "did the analytics come back?" is a
 * question about whether they can be FOUND. They were still reachable while
 * the issue was open; what was missing was any way to get to them.
 *
 * The numbers themselves are asserted against seeded rows in
 * `tests/analytics.test.ts`. What this walk adds is that each address resolves
 * to its own page rather than being read as a record id by the section's
 * `:id` route — the failure mode that would open a user record for a user
 * called "analytics" — and that each page asks for its own projection.
 */
test("each domain's analytics answer under the domain, reached from its own sidebar entry", async ({ page }) => {
  const projections: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/analytics/")) projections.push(pathname);
  });

  await signInToPortal(page, e2eAdminEmail("portal-analytics"));

  const pages = [
    {
      section: "Members",
      heading: "Membership analytics",
      url: /#\/members\/analytics$/,
      api: "/api/v1/analytics/members",
    },
    {
      section: "Organizations",
      heading: "Organization analytics",
      url: /#\/organizations\/analytics$/,
      api: "/api/v1/analytics/organizations",
    },
    { section: "Users", heading: "User analytics", url: /#\/users\/analytics$/, api: "/api/v1/analytics/users" },
  ];

  // The site's own header and footer also link "Members" and "Users", so the
  // walk is scoped to the portal's navigation.
  const sidebar = page.getByLabel("Portal navigation");

  for (const subject of pages) {
    // Through the sidebar: the section, then the Analytics page under it.
    await sidebar.getByRole("link", { name: subject.section, exact: true }).click();
    const nested = sidebar.getByRole("link", { name: "Analytics", exact: true });
    await expect(nested.first()).toBeVisible({ timeout: 15_000 });
    await nested.first().click();

    await expect(page).toHaveURL(subject.url, { timeout: 15_000 });
    // Its own page, not a record whose id is the word "analytics".
    // The shell owns `<h1>`; a page heads itself with `<h2>`.
    await expect(page.getByRole("heading", { name: subject.heading, level: 2 })).toBeVisible({ timeout: 15_000 });
    // And it asked the server for the numbers rather than counting a list.
    expect(projections).toContain(subject.api);
  }
});
