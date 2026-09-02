/**
 * My Participation — the identity's complete record across the consortium:
 * registrations, ballot history, proposals, donations, and membership
 * applications, each as its own bounded panel with its own loading, error,
 * and empty state. Nothing exercised this page before; the dashboard's
 * "Needs your voice" panel (Home) surfaces the same vote and application
 * data as an attention list, but never this full-record view.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";

test("a freshly approved member sees their application and empty records elsewhere", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `participation-${suffix}@participation-${suffix}.test`;
  const organizationName = `Participation Org ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-vote-election"));
  await approveMemberThroughReview(page, {
    email,
    name: `Participation Member ${suffix}`,
    organizationName,
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/participation");
  await expect(page.getByRole("heading", { name: "My participation" })).toBeVisible();
  // The sidebar and the top nav each carry their own "Home" link; this is the
  // page's own inline pointer back to the dashboard.
  await expect(page.locator("#portal-main").getByRole("link", { name: "Home" })).toBeVisible();

  const applicationsPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Membership applications" }) });
  await expect(applicationsPanel).toBeVisible();
  const applicationLink = applicationsPanel.getByRole("link", { name: /^Application from/ });
  await expect(applicationLink).toBeVisible({ timeout: 15_000 });

  const registrationsPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Event registrations" }) });
  await expect(registrationsPanel.getByText("No event registrations yet.")).toBeVisible();

  const proposalsPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Event proposals" }) });
  await expect(proposalsPanel.getByText("No event proposals are linked to your account.")).toBeVisible();

  const donationsPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Donations" }) });
  await expect(donationsPanel.getByText("No donations recorded for your verified email.")).toBeVisible();

  // Votes is a member-only panel and reads real group data, so this only
  // asserts it renders as a panel with a real state — not a specific count,
  // which depends on whatever the seeded groups currently have open.
  const votesPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Votes", exact: true }) });
  await expect(votesPanel).toBeVisible();

  // The link lands on My Application's list, not the detail directly — that
  // list-then-detail structure is MyApplications' own, so this only proves
  // the link reaches the right page and its one row opens.
  await applicationLink.click();
  await expect(page.getByRole("heading", { name: "My application" })).toBeVisible({ timeout: 15_000 });
  const openRow = page.getByRole("button", { name: /^Open the application submitted/ });
  await expect(openRow).toBeVisible({ timeout: 15_000 });
  await openRow.click();
  await expect(page.getByRole("heading", { name: `Participation Member ${suffix}` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Back to applications" })).toBeVisible();
});
