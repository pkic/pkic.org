/**
 * My Organization — the representative's own moderated workspace: content
 * edits and logo changes queue for staff review rather than publishing
 * directly, and the primary contact alone may nominate a secondary contact.
 * None of this had browser coverage: the staff organization-detail logo
 * control is a different component from the member-facing `LogoUploader`
 * here, and nothing exercised the content
 * review queue, the secondary-contact nomination, or the individual-member
 * fallback at all.
 * @covers organization.10.1
 * @covers organization.10.2
 * @covers organization.10.3
 */
import { expect, test } from "@playwright/test";
import { organizationContactDetailsUpdateSchema } from "../../assets/shared/schemas/organization-contact-details";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";
import { uploadThroughButton } from "./helpers/file-upload";

// A full-canvas single-color fill reads to the sanitizer's crop step as
// background with nothing to crop to ("The SVG has no visible content."), so
// this uses the shape the sanitizer accepts: a background
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

  // The way back (issue #9). A representative has no Organizations entry in
  // the sidebar, so without the trail this record is where navigation stops.
  const recordUrl = page.url();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Organizations" }).click();
  await expect(page).toHaveURL(/\/portal\/#\/organizations$/);
  // And the list it lands on is the one this record was opened from.
  await expect(page.locator("tr").filter({ hasText: organizationName })).toBeVisible({ timeout: 15_000 });
  await page.goto(recordUrl);
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible({ timeout: 15_000 });

  // Private channels save directly and persist independently of public content review.
  const privateContacts = page.getByRole("region", { name: "Private contact details", exact: true });
  await privateContacts.getByRole("button", { name: "Add contact details" }).click();
  const contactEditor = page.getByRole("dialog", { name: "Private contact details", exact: true });
  const contactEmail = `office-${suffix}@example.test`;
  await contactEditor.getByLabel("Organization email").fill(contactEmail);
  await contactEditor.getByLabel("Phone", { exact: true }).fill("+1 202 555 0100");
  await contactEditor.getByLabel("Street address").fill("123 Example St\nSuite 2");
  await contactEditor.getByLabel("City", { exact: true }).fill("Example City");
  await contactEditor.getByLabel("State or region").fill("DC");
  await contactEditor.getByLabel("Postal code").fill("20001");
  await contactEditor.getByLabel("Country", { exact: true }).fill("United States");
  const privateSaved = page.waitForResponse(
    (response) =>
      /\/organizations\/[^/]+\/contacts\/details$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT",
  );
  await contactEditor.getByRole("button", { name: "Save contact details" }).click();
  const privateResponse = await privateSaved;
  expect(privateResponse.status()).toBe(200);
  expect(organizationContactDetailsUpdateSchema.parse(privateResponse.request().postDataJSON())).toMatchObject({
    email: contactEmail,
    postalAddress: { lines: ["123 Example St", "Suite 2"], city: "Example City", region: "DC", postalCode: "20001" },
    countryCode: "US",
    revision: 0,
  });
  await expect(contactEditor).not.toBeVisible();
  await page.reload();
  await expect(privateContacts.getByText(contactEmail, { exact: true })).toBeVisible();
  await privateContacts.getByRole("button", { name: "Private contact details actions" }).click();
  await page.getByRole("menuitem", { name: "Edit contact details…" }).click();
  await expect(contactEditor.getByLabel("Street address")).toHaveValue("123 Example St\nSuite 2");
  await expect(contactEditor.getByLabel("City", { exact: true })).toHaveValue("Example City");
  await expect(contactEditor.getByLabel("State or region")).toHaveValue("DC");
  await expect(contactEditor.getByLabel("Postal code")).toHaveValue("20001");
  await contactEditor.getByRole("button", { name: "Cancel", exact: true }).click();

  // Logo first: the review record it creates is the same one content changes
  // land in, so submitting content afterward exercises the merge rather than
  // a second, independent review.
  const logoSubmitted = page.waitForResponse((response) =>
    /\/organizations\/[^/]+\/logo$/.test(new URL(response.url()).pathname),
  );
  // Through the tile, not past it (#28). The tile is named for what pressing
  // it does and whose logo it is: "Upload logo of …" until there is one.
  await uploadThroughButton(page, `Upload logo of ${organizationName}`, {
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: SANITIZED_SVG,
  });
  const logoResponse = await logoSubmitted;
  expect(logoResponse.status(), await logoResponse.text().catch(() => "")).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Logo submitted for review" })).toBeVisible({ timeout: 15_000 });

  const editorPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Member page content" }) });
  await expect(editorPanel.getByText("A content change is pending staff review", { exact: false })).toBeVisible();
  await expect(editorPanel.getByRole("listitem").filter({ hasText: "Logo: a new logo" })).toBeVisible();
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
  await expect(editorPanel.getByLabel("Slogan")).toHaveCount(0);

  await editorPanel.getByRole("button", { name: "Member page content actions" }).click();
  await page.getByRole("menuitem", { name: "Edit settings" }).click();

  // Now content: the form is back, and a real field submission queues a
  // second review naming exactly the fields that changed.
  await editorPanel.getByLabel("Slogan").fill("A slogan awaiting review");
  await editorPanel.getByLabel("Description").fill("A description awaiting review.");
  await editorPanel
    .getByRole("textbox", { name: "Long-form content (Markdown)", exact: true })
    .fill("A member page awaiting review.");
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
  await expect(editorPanel.getByText("A member page awaiting review.", { exact: true })).toBeVisible();

  const contentWithdrawn = page.waitForResponse(
    (response) =>
      /\/content\/reviews\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "DELETE",
  );
  await editorPanel.getByRole("button", { name: "Withdraw submission" }).click();
  await acceptConfirmDialog(page, "Withdraw submission");
  expect((await contentWithdrawn).status()).toBe(200);
  await expect(editorPanel.getByLabel("Slogan")).toHaveCount(0);
  await editorPanel.getByRole("button", { name: "Member page content actions" }).click();
  await page.getByRole("menuitem", { name: "Edit settings" }).click();
  await expect(editorPanel.getByLabel("Slogan")).toHaveValue("");
  await editorPanel.getByRole("button", { name: "Cancel", exact: true }).click();

  // The organization's own public profile never changed: every submission
  // above was withdrawn before a staff decision, so the tile still offers to
  // upload one rather than to change it.
  await expect(page.getByRole("button", { name: `Upload logo of ${organizationName}` })).toBeVisible();
});

test("the primary contact nominates and withdraws a secondary-contact nomination", async ({ page }, testInfo) => {
  test.slow();
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
          jobTitle: "Engineer",
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

  const governancePanel = page.getByRole("region", { name: "Contacts", exact: true });
  await expect(governancePanel.getByText("None pending", { exact: false })).toHaveCount(0);
  const nominee = governancePanel.getByLabel("Nominee");
  await expect(nominee).toBeVisible();

  const nominated = page.waitForResponse(
    (response) =>
      /\/contacts\/secondary\/nomination$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT",
  );
  await nominee.selectOption({ label: repName });
  await governancePanel.getByRole("button", { name: "Send nomination" }).click();
  expect((await nominated).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Secondary contact nominated" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(nominee).toHaveValue(/.+/);

  await page.reload();
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible({ timeout: 15_000 });
  const reloadedGovernancePanel = page.getByRole("region", { name: "Contacts", exact: true });
  await expect(reloadedGovernancePanel.getByLabel("Nominee")).toHaveValue(/.+/);

  const withdrawn = page.waitForResponse(
    (response) =>
      /\/contacts\/secondary\/nomination$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "DELETE",
  );
  await reloadedGovernancePanel.getByLabel("Nominee").selectOption({ label: "None" });
  await reloadedGovernancePanel.getByRole("button", { name: "Withdraw nomination" }).click();
  expect((await withdrawn).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Nomination withdrawn" })).toBeVisible({ timeout: 15_000 });

  // Nomination and assignment are separate: staff confirmation makes this person
  // the secondary contact, while an ordinary coworker gains no contact powers.
  await reloadedGovernancePanel.getByLabel("Nominee").selectOption({ label: repName });
  await reloadedGovernancePanel.getByRole("button", { name: "Send nomination" }).click();
  await expect(reloadedGovernancePanel.getByText(/Pending staff confirmation:/)).toBeVisible();
  await page.context().clearCookies();
  await signInToPortal(page, e2eAdminEmail("meeting-guest"));
  const confirmation = await page.request.post(
    `/api/v1/organizations/${added.organizationId}/contacts/secondary/confirmation`,
  );
  expect(confirmation.status()).toBe(200);
  const ordinaryEmail = `ordinary-${suffix}@my-org-nominate-${suffix}.test`;
  const ordinary = await page.request.post(`/api/v1/organizations/${added.organizationId}/identities`, {
    data: {
      userReference: "email",
      name: "Ordinary Representative",
      email: ordinaryEmail,
      jobTitle: "Engineer",
      activation: { mode: "immediate", reason: "E2E ordinary representative setup" },
      showOnOrganizationProfile: false,
    },
  });
  expect(ordinary.status()).toBe(201);

  for (const [email, role] of [
    [primaryEmail, "Primary contact"],
    [repEmail, "Secondary contact"],
    [ordinaryEmail, "Representative"],
  ]) {
    await page.context().clearCookies();
    await signInToPortal(page, email);
    await page.goto(`/portal/#/organizations/${added.organizationId}`);
    const contacts = page.getByRole("region", { name: "Contacts", exact: true });
    await expect(contacts).toBeVisible();
    await expect(contacts.locator("dt", { hasText: /^Secondary contact$/ }).locator("+ dd")).toContainText(repName);
    await expect(contacts.locator("dt", { hasText: /^Primary contact$/ }).locator("+ dd")).toContainText(
      `Primary Contact ${suffix}`,
    );
    const yourRole = contacts.locator("dt", { hasText: "Your role" }).locator("+ dd");
    await expect(yourRole).toHaveText(role);
    await expect(contacts.getByLabel(/nominee/i)).toHaveCount(role === "Primary contact" ? 1 : 0);
    await expect(contacts.getByText(/Pending staff confirmation:/)).toHaveCount(0);
    const profile = await page.request.get(`/api/v1/organizations/${added.organizationId}/profile`);
    expect(profile.status()).toBe(200);
    const data = await profile.json();
    expect(data.organization.secondaryContact.userName).toBe(repName);
    expect(data.organization.isSecondaryContact).toBe(role === "Secondary contact");
    if (role !== "Primary contact") {
      const refused = await page.request.delete(
        `/api/v1/organizations/${added.organizationId}/contacts/secondary/nomination`,
      );
      expect(refused.status()).toBe(403);
    }
    await page.reload();
    await expect(yourRole).toHaveText(role);
    await expect(page.getByText("Ordinary Representative", { exact: true }).first()).toBeVisible();
    if (role !== "Representative")
      await expect(page.getByText("No profile changes submitted yet", { exact: true })).toBeVisible();
    for (const [name, width] of [
      ["desktop", 1440],
      ["phone", 375],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await contacts.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await expect(contacts).toBeInViewport({ ratio: 1 });
      const screenshot = testInfo.outputPath(`contacts-${role.toLowerCase().replaceAll(" ", "-")}-${name}.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach(`Contacts: ${role}, ${name}`, { path: screenshot, contentType: "image/png" });
    }
    const representatives = page.getByRole("region", { name: "Representatives", exact: true }).first();
    await expect(representatives.getByRole("columnheader", { name: "Contact role", exact: true })).toHaveCount(0);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await representatives.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`representatives-${role.replaceAll(" ", "-")}-${width}.png`),
        fullPage: true,
      });
    }
    if (role !== "Representative") {
      await representatives.getByRole("button", { name: "Add coworker", exact: true }).click();
      await expect(page).toHaveURL(/\/representatives\/new$/);
      await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Add a coworker", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Contacts", exact: true })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Representatives", exact: true })).toHaveCount(0);
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: testInfo.outputPath(`add-representative-${role.replaceAll(" ", "-")}-${width}.png`),
          fullPage: true,
        });
      }
      await page.reload();
      await expect(page.getByRole("heading", { name: "Add a coworker", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/organizations/${added.organizationId}$`));
      await expect(page.getByRole("region", { name: "Contacts", exact: true })).toBeVisible();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
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

test("staff open an organization representative directly from the person's name", async ({ page, browser }) => {
  const suffix = uniqueSuffix();
  const personName = `Roster Link ${suffix}`;
  const organizationName = `Roster Link Organization ${suffix}`;
  await signInToPortal(page, e2eAdminEmail("portal-join-categories"));
  const member = await approveMemberThroughReview(page, {
    email: `roster-link-${suffix}@roster-link-${suffix}.test`,
    name: personName,
    organizationName,
  });

  for (const width of [1280, 375]) {
    const view = await browser.newPage({
      storageState: await page.context().storageState(),
      viewport: { width, height: 900 },
      hasTouch: width === 375,
    });
    try {
      await view.goto("/portal/#/organizations");
      const search = view.getByPlaceholder("organization name");
      await search.fill(organizationName);
      await search.press("Enter");
      await view.getByRole("row").filter({ hasText: organizationName }).click();
      await expect(view.getByRole("heading", { name: organizationName, exact: true })).toBeVisible();
      const roster = view.getByRole("table", { name: "Representatives", exact: true });
      const name = roster.getByText(personName, { exact: true }).first();
      await expect(name).toBeVisible();
      if (width === 1280) {
        await name.hover();
        await expect(view.getByRole("dialog", { name: `About ${personName}` })).toBeVisible();
        await name.click();
      } else {
        await name.tap();
      }
      await expect(view).toHaveURL(new RegExp(`/portal/#/users/${member.userId}$`));
      await expect(view.getByRole("heading", { name: personName, exact: true })).toBeVisible();
    } finally {
      await view.close();
    }
  }
});
