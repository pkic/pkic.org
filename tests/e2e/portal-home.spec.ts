/**
 * Home — the sign-in landing: participation that needs the reader's voice,
 * then upcoming activity, with the represented organization in the header.
 * Every panel reads its own bounded server page, here against the real API a
 * signed-in member actually gets rather than intercepted fixtures.
 * @covers profile.11.5
 * @covers profile.11.6
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";

test("a member's Home shows their organization and a pending review once one exists", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `home-${suffix}@home-${suffix}.test`;
  const firstName = "Home";
  const organizationName = `Home Org ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-proposal-states"));
  // A plain two-word name, with the uniquing suffix carried by the email
  // instead: name-splitting into first/last name is an implementation
  // detail this test should not have to predict.
  await approveMemberThroughReview(page, { email, name: `${firstName} Member`, organizationName });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  const meetingStartsAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await page.route("**/api/v1/users/current/meetings/series**", async (route) => {
    await route.fulfill({
      json: {
        series: [
          {
            seriesId: "40000000-0000-4000-8000-000000000002",
            eventId: "40000000-0000-4000-8000-000000000003",
            groupId: "10000000-0000-4000-8000-000000000001",
            groupName: "Post-Quantum Cryptography Working Group",
            eventName: "PQC Test Meeting",
            startsAt: meetingStartsAt,
            recurrenceRule: "FREQ=WEEKLY;INTERVAL=2",
            timezone: "Europe/Amsterdam",
            nextOccurrenceId: "40000000-0000-4000-8000-000000000001",
            nextStartsAt: meetingStartsAt,
            nextEndsAt: new Date(Date.now() + 70 * 60_000).toISOString(),
            canJoin: true,
          },
        ],
        page: { limit: 5, offset: 0, total: 1, hasMore: false },
      },
    });
  });
  await page.goto("/portal/#/home");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText(`Welcome back, ${firstName}.`)).toBeVisible();

  const meetingsPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Upcoming meetings" }) });
  await expect(meetingsPanel.getByText("PQC Test Meeting")).toBeVisible();
  await expect(meetingsPanel.getByText(/Every other .* at/)).toBeVisible();
  await expect(meetingsPanel.getByRole("link", { name: "Download the full series calendar (.ics)" })).toHaveAttribute(
    "href",
    /calendar\.ics\?personal=true$/,
  );
  await expect(meetingsPanel.getByRole("link", { name: "Download only the next meeting (.ics)" })).toHaveAttribute(
    "href",
    /occurrenceId=40000000-0000-4000-8000-000000000001$/,
  );
  await expect(meetingsPanel.getByRole("link", { name: "Join meeting" })).toBeVisible();
  await expect(meetingsPanel.locator("footer")).toContainText("Do not share");
  await meetingsPanel.screenshot({ path: test.info().outputPath("upcoming-meetings.png") });

  await expect(page.getByRole("heading", { name: "Needs your voice" })).toHaveCount(0);

  const affiliation = page.locator(".pk-home-affiliation");
  await expect(affiliation).toBeVisible();
  const organizationLink = affiliation.getByRole("link", { name: organizationName });
  await expect(organizationLink).toBeVisible();
  await expect(affiliation.getByText("Primary contact")).toBeVisible();
  await expect(affiliation.getByRole("link", { name: "View all" })).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Quick links" }).getByRole("link", { name: "Working groups" }),
  ).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("home-dashboard-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("home-dashboard-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Nothing is waiting until a content review is actually pending — this
  // proves the panel is reading live organization state, not a snapshot from
  // sign-in.
  const submitted = await page.evaluate(async (organizationName) => {
    const orgList = await fetch(`/api/v1/users/current/organizations?search=${encodeURIComponent(organizationName)}`, {
      credentials: "same-origin",
    });
    const { organizations } = (await orgList.json()) as { organizations: Array<{ organizationId: string }> };
    const organizationId = organizations[0]?.organizationId;
    const response = await fetch(`/api/v1/organizations/${organizationId}/content/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ slogan: "Home dashboard review probe" }),
    });
    return { status: response.status, body: await response.json() };
  }, organizationName);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

  await page.reload();
  const reloadedAttentionPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Needs your voice" }) });
  const reviewItem = reloadedAttentionPanel.getByRole("link", { name: `Review pending: ${organizationName}` });
  await expect(reviewItem).toBeVisible({ timeout: 15_000 });

  await Promise.all([page.waitForURL(/\/portal\/#\/organizations\/[^/]+$/), reviewItem.click()]);
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible({ timeout: 15_000 });
});

test("an individual member with no represented organization sees the honest empty state", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `home-individual-${suffix}@home-individual-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("portal-proposal-states-rejected"));
  await approveMemberThroughReview(page, {
    email,
    name: `Home Individual ${suffix}`,
    category: "H5",
    unaffiliatedAttestation: true,
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/home");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

  await expect(page.locator(".pk-home-affiliation").getByText("Participating as an individual")).toBeVisible();
});
