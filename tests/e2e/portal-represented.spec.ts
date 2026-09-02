/**
 * Represented Organizations — the plain member's own slice of the
 * organization directory: only what they represent, with their role and any
 * pending review flagged, each row opening into that organization's own
 * workspace. Staff with `organizations:read` see the full directory
 * (`Organizations`, covered under the staff surfaces) through the same
 * `/organizations` route; this spec is the representative's view of it.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";

test("a representative sees their own organization, role, and pending review, and opens it", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `represented-${suffix}@represented-${suffix}.test`;
  const organizationName = `Represented Org ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-vote-window"));
  await approveMemberThroughReview(page, { email, name: `Represented Member ${suffix}`, organizationName });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/organizations");
  await expect(page.getByRole("heading", { name: "Your organizations" })).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: organizationName });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Primary contact")).toBeVisible();
  // A freshly-approved organization has nothing pending, so the review
  // column is genuinely blank for this row.
  await expect(row.getByText("Review pending")).toHaveCount(0);

  // Submit a content change so the same row picks up the review flag on the
  // next load — proving the column reads live state, not a fixture.
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
      body: JSON.stringify({ slogan: "Represented org, mid-review" }),
    });
    return { status: response.status, body: await response.json() };
  }, organizationName);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your organizations" })).toBeVisible();
  const reloadedRow = page.getByRole("row").filter({ hasText: organizationName });
  await expect(reloadedRow).toBeVisible({ timeout: 15_000 });
  await expect(reloadedRow.getByText("Review pending")).toBeVisible();

  await Promise.all([
    page.waitForURL(/\/portal\/#\/organizations\/[^/]+$/),
    reloadedRow.getByRole("link", { name: `Open ${organizationName}` }).click(),
  ]);
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible({ timeout: 15_000 });
});

test("a member who represents nothing sees the empty state", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `represented-empty-${suffix}@represented-empty-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("portal-vote-eligibility"));
  await approveMemberThroughReview(page, {
    email,
    name: `Represented Empty ${suffix}`,
    category: "H5",
    unaffiliatedAttestation: true,
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/organizations");
  await expect(page.getByRole("heading", { name: "Your organizations" })).toBeVisible();
  await expect(page.getByText("You do not represent any organizations right now.")).toBeVisible();
});
