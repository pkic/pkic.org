/**
 * Home — the sign-in landing: participation that needs the reader's voice,
 * then upcoming activity, then the organizations and applications the
 * identity holds. Every panel reads its own bounded server page; this was
 * previously exercised only through `portal-personas.spec.ts`'s intercepted
 * fixtures, never against the real API a signed-in member actually gets.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";

test("a member's Home shows their organization, application, and a pending review once one exists", async ({
  page,
}) => {
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
  await page.goto("/portal/#/home");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText(`Welcome back, ${firstName}.`)).toBeVisible();

  const attentionPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Needs your voice" }) });
  await expect(attentionPanel).toBeVisible();
  await expect(attentionPanel.getByText("Nothing is waiting on you right now.")).toBeVisible();

  const organizationsPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Your organizations" }) });
  await expect(organizationsPanel).toBeVisible();
  const organizationLink = organizationsPanel.getByRole("link", { name: organizationName });
  await expect(organizationLink).toBeVisible();
  await expect(organizationsPanel.getByText("Primary contact")).toBeVisible();
  await expect(organizationsPanel.getByRole("link", { name: "View all" })).toBeVisible();

  const applicationsPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Your membership applications" }) });
  await expect(applicationsPanel).toBeVisible();
  await expect(applicationsPanel.getByRole("link", { name: /^Application from/ })).toBeVisible();

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

  const organizationsPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Your organizations" }) });
  await expect(
    organizationsPanel.getByText("You do not represent an organization. Individual participation works just the same."),
  ).toBeVisible();
});
