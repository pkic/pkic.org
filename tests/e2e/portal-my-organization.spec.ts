/**
 * My Organization — the representative's own moderated workspace: content
 * edits and logo changes queue for staff review rather than publishing
 * directly, and the primary contact alone may nominate a secondary contact.
 * None of this had browser coverage: `svg-logo-upload.spec.ts` drives the
 * *staff* organization-detail logo control, a different component from the
 * member-facing `LogoUploader` here, and nothing exercised the content
 * review queue, the secondary-contact nomination, or the individual-member
 * fallback at all.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";

// A full-canvas single-colour fill reads to the sanitizer's crop step as
// background with nothing to crop to ("The SVG has no visible content."), so
// this mirrors svg-logo-upload.spec.ts's own working shape: a background
// rect plus a distinct, smaller rect the sanitizer can crop the logo to.
const SANITIZED_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
    '<rect width="100%" height="100%" fill="#ffffff"/>' +
    '<rect x="50" y="50" width="100" height="100" fill="#4477aa"/></svg>',
  "utf-8",
);

test("an organization contact submits a logo and content changes for review, then withdraws each", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `my-org-content-${suffix}@my-org-content-${suffix}.test`;
  const organizationName = `My Org Content ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-join-categories"));
  await approveMemberThroughReview(page, { email, name: `My Org Content ${suffix}`, organizationName });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/organization");
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/portal\/#\/organizations\/[^/]+$/);

  // Logo first: the review record it creates is the same one content changes
  // land in, so submitting content afterward exercises the merge rather than
  // a second, independent review.
  await page.getByRole("button", { name: "Change logo (SVG)" }).click();
  const logoSubmitted = page.waitForResponse((response) =>
    /\/organizations\/[^/]+\/logo$/.test(new URL(response.url()).pathname),
  );
  await page.locator('input[type="file"][accept="image/svg+xml"]').setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: SANITIZED_SVG,
  });
  const logoResponse = await logoSubmitted;
  expect(logoResponse.status(), await logoResponse.text().catch(() => "")).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Logo submitted for review" })).toBeVisible({ timeout: 15_000 });

  const editorPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Edit organization content" }) });
  await expect(editorPanel.getByText("A content change is pending staff review", { exact: false })).toBeVisible();
  await expect(editorPanel.getByText("Includes a new logo.")).toBeVisible();
  // The pending review occupies the editor slot, so the form itself is gone
  // until the submission is decided or withdrawn.
  await expect(editorPanel.getByLabel("Slogan")).toHaveCount(0);

  const logoWithdrawn = page.waitForResponse(
    (response) =>
      /\/content\/reviews\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "DELETE",
  );
  await editorPanel.getByRole("button", { name: "Withdraw submission" }).click();
  await acceptConfirmDialog(page, "Withdraw submission");
  expect((await logoWithdrawn).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Submission withdrawn" })).toBeVisible({ timeout: 15_000 });
  await expect(editorPanel.getByLabel("Slogan")).toBeVisible();

  // Now content: the form is back, and a real field submission queues a
  // second review naming exactly the fields that changed.
  await editorPanel.getByLabel("Slogan").fill("A slogan awaiting review");
  await editorPanel.getByLabel("Description").fill("A description awaiting review.");
  await editorPanel.getByLabel("Website").fill("https://example.test/my-org-content");
  const contentSubmitted = page.waitForResponse(
    (response) => /\/organizations\/[^/]+\/content\/reviews$/.test(new URL(response.url()).pathname) && response.ok(),
  );
  await editorPanel.getByRole("button", { name: "Submit for review" }).click();
  expect((await contentSubmitted).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Submitted for staff review" })).toBeVisible({ timeout: 15_000 });

  await expect(editorPanel.getByText("Slogan:", { exact: false })).toBeVisible();
  await expect(editorPanel.getByText("A slogan awaiting review")).toBeVisible();
  await expect(editorPanel.getByText("Website:", { exact: false })).toBeVisible();

  const contentWithdrawn = page.waitForResponse(
    (response) =>
      /\/content\/reviews\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "DELETE",
  );
  await editorPanel.getByRole("button", { name: "Withdraw submission" }).click();
  await acceptConfirmDialog(page, "Withdraw submission");
  expect((await contentWithdrawn).status()).toBe(200);
  await expect(editorPanel.getByLabel("Slogan")).toHaveValue("");

  // The organization's own public profile never changed: every submission
  // above was withdrawn before a staff decision.
  const profilePanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Public profile" }) });
  await expect(profilePanel.getByText("No logo", { exact: true })).toBeVisible();
});

test("the primary contact nominates and withdraws a secondary-contact nomination", async ({ page }) => {
  const suffix = uniqueSuffix();
  const primaryEmail = `my-org-nominate-${suffix}@my-org-nominate-${suffix}.test`;
  const organizationName = `My Org Nominate ${suffix}`;
  const repName = `Nominee Rep ${suffix}`;
  const repEmail = `my-org-nominee-${suffix}@my-org-nominate-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("meeting-guest"));
  await approveMemberThroughReview(page, {
    email: primaryEmail,
    name: `Primary Contact ${suffix}`,
    organizationName,
  });

  // A third identity, added to the already-approved organization, arrives
  // active but holds no contact role of its own — exactly the pool the
  // nomination select draws from.
  const added = await page.evaluate(
    async ({ organizationName, repName, repEmail }) => {
      // `search` matches loosely across shared tokens ("My", "Org", ...), so a
      // sibling test's similarly-named organization can outrank this one — an
      // exact match on the returned `name` is what actually identifies it.
      const orgList = await fetch(`/api/v1/organizations?search=${encodeURIComponent(organizationName)}&limit=50`, {
        credentials: "same-origin",
      });
      const { organizations } = (await orgList.json()) as { organizations: Array<{ id: string; name: string }> };
      const organizationId = organizations.find((organization) => organization.name === organizationName)?.id;
      const response = await fetch(`/api/v1/organizations/${organizationId}/identities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          userReference: "email",
          name: repName,
          email: repEmail,
          activation: { mode: "immediate", reason: "E2E secondary-contact nomination setup" },
          showOnOrganizationProfile: false,
        }),
      });
      return { status: response.status, body: await response.json(), organizationId };
    },
    { organizationName, repName, repEmail },
  );
  expect(added.status, JSON.stringify(added.body)).toBe(201);

  await page.context().clearCookies();
  await signInToPortal(page, primaryEmail);
  await page.goto("/portal/#/organization");
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible({ timeout: 15_000 });

  const governancePanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Secondary contact" }) });
  await expect(governancePanel.getByText("None pending", { exact: false })).toHaveCount(0);
  const nominee = governancePanel.getByLabel("Nominee");
  await expect(nominee).toBeVisible();

  const nominated = page.waitForResponse(
    (response) =>
      /\/contacts\/secondary\/nomination$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT",
  );
  await nominee.selectOption({ label: repName });
  expect((await nominated).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Secondary contact nominated" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(nominee).toHaveValue(/.+/);

  await page.reload();
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible({ timeout: 15_000 });
  const reloadedGovernancePanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Secondary contact" }) });
  await expect(reloadedGovernancePanel.getByLabel("Nominee")).toHaveValue(/.+/);

  const withdrawn = page.waitForResponse(
    (response) =>
      /\/contacts\/secondary\/nomination$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "DELETE",
  );
  await reloadedGovernancePanel.getByLabel("Nominee").selectOption({ label: "None" });
  expect((await withdrawn).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Nomination withdrawn" })).toBeVisible({ timeout: 15_000 });
});

test("a member whose active identity is individual sees the individual-membership fallback", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `my-org-individual-${suffix}@my-org-individual-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("portal-appearance"));
  // H5/H6/H7 are the individual membership categories: no organization is
  // ever attached, so `approveMemberThroughReview` is called with no
  // `organizationName` at all.
  await approveMemberThroughReview(page, {
    email,
    name: `My Org Individual ${suffix}`,
    category: "H5",
    unaffiliatedAttestation: true,
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/organization");

  await expect(page.getByRole("heading", { name: "My organization" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Your membership is individual.")).toBeVisible();
  await expect(page.getByText("You participate in the consortium in your own name", { exact: false })).toBeVisible();
  // No redirect happened this time: an individual identity has no acting
  // organization to be sent to.
  await expect(page).toHaveURL(/\/portal\/#\/organization$/);
});
