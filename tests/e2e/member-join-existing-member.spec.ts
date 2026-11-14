/** Returning members should reach sign-in, not another application. @covers join.1.0 */
import { expect, test } from "@playwright/test";
import { userCreateSchema } from "../../assets/shared/schemas/user-create";
import { memberApplicationCreateSchema } from "../../assets/shared/schemas/member-applications";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../assets/shared/email-first-copy";
import { memberJoinVerifyResponseSchema } from "../../assets/shared/schemas/member-join";
import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { approveMemberThroughReview, submitMembershipApplication, uniqueSuffix } from "./helpers/membership";
import { openMyProfile, signInToPortal } from "./helpers/portal-auth";
import { startJoinInBrowser } from "./helpers/member-join";
import { signInThroughCard } from "./helpers/sign-in-card";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import {
  createMember,
  jsonResponse,
  recordProperty,
  memberIdentityOf,
  stringProperty,
} from "./helpers/member-provisioning";

test("an existing member who returns to the join page is sent to the portal, not to another application", async ({
  page,
  browser,
}) => {
  const suffix = uniqueSuffix();
  const email = `returning-${suffix}@returning-${suffix}.test`;
  const organizationName = `Returning Organization ${suffix}`;
  await signInToPortal(page, e2eAdminEmail("portal-vote-election"));
  await approveMemberThroughReview(page, { email, name: `Returning Member ${suffix}`, organizationName });

  const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const member = await memberContext.newPage();
    await member.goto("/join/");
    await signInThroughCard(member, email, { emailFlow: "join", returning: true });
    // Signed in personally, a representative cannot apply as an individual beside their organization.
    await expect(member.getByRole("heading", { name: "Apply for your organization instead" })).toBeVisible();
    await expect(member.locator("[data-join-application-form]")).toBeHidden();
    await member.getByRole("button", { name: "Change representation", exact: true }).click();
    const chooser = member.getByRole("dialog", { name: "Change representation", exact: true });
    await chooser.getByRole("combobox", { name: "Representation", exact: true }).click();
    await member.getByRole("option").filter({ hasText: organizationName }).click();
    await chooser.getByRole("button", { name: "Use representation", exact: true }).click();
    await expect(member.getByRole("heading", { name: `${organizationName} is already a member` })).toBeVisible();
    await expect(member.locator("[data-join-application-form]")).toBeHidden();
    await member
      .locator("[data-join-signed-in]")
      .screenshot({ path: test.info().outputPath("returning-member-guidance.png") });
    await member.getByRole("link", { name: "Manage membership", exact: true }).click();
    await expect(member).toHaveURL(/\/portal\/#\/organizations\//);
    await expect(member.getByRole("button", { name: "Account menu" })).toBeVisible();
  } finally {
    await memberContext.close();
  }
});

test("a verified address on a shared domain needs approval for member access", async ({ page: staff, browser }) => {
  let page = staff;
  const suffix = uniqueSuffix();
  await signInToPortal(page, e2eAdminEmail("shared-organization-domains"));
  const first = await createMember(page, { organizationName: `Shared First ${suffix}` });
  const second = await createMember(page, { organizationName: `Shared Second ${suffix}` });
  const later = await createMember(page, { organizationName: `Later Organization ${suffix}` });
  const secondUser = recordProperty(await jsonResponse(page.request, "GET", `/api/v1/users/${second.userId}`), "user");
  const secondIdentity = memberIdentityOf(secondUser);
  const secondOrganization = stringProperty(secondIdentity, "organizationId");
  const domain = first.email.split("@")[1];
  await page.goto(`/portal/#/organizations/${secondOrganization}/domains/new`);
  await page.getByRole("textbox", { name: "Domain (required)", exact: true }).fill(domain);
  await page
    .getByRole("textbox", { name: "Reason (required)", exact: true })
    .fill("Both organizations use this test domain");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: test.info().outputPath("domain-claim-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: test.info().outputPath("domain-claim-phone.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Claim domain", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: `Claim @${domain} for Shared Second ${suffix}?` });
  await expect(confirmation.getByText("People with this email domain will choose their organization.")).toBeVisible();
  await confirmation.getByRole("button", { name: "Claim domain", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${secondOrganization}/domains$`));
  const independentEmail = `independent-${suffix}@${domain}`;
  const independentUser = await page.request.post("/api/v1/users", {
    data: userCreateSchema.parse({ email: independentEmail, firstName: "Casey", lastName: "Independent" }),
  });
  expect(independentUser.status(), await independentUser.text()).toBe(201);

  // Each person arrives in a browser of their own.
  const origin = new URL(staff.url()).origin;
  const colleagueContext = await browser.newContext({ baseURL: origin });
  page = await colleagueContext.newPage();
  const email = `colleague-${suffix}@${domain}`;
  await startJoinInBrowser(page, email);
  const choice = page.getByRole("combobox", { name: "Organization (required)", exact: true });
  await expect(choice).toBeVisible();
  await expect(page.getByText(`Choose the organization you represent at @${domain}.`)).toBeVisible();
  await expect(choice).toHaveValue("");
  await expect(choice.locator("option")).toHaveText([
    "Choose an organization",
    `Shared First ${suffix}`,
    `Shared Second ${suffix}`,
  ]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await choice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("shared-organization-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await choice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("shared-organization-phone.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await choice.selectOption({ label: `Shared Second ${suffix}` });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("[data-join-support-required]")).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.screenshot({ path: test.info().outputPath(`shared-member-review-required-${width}.png`) });
  }
  await colleagueContext.close();
  const independentContext = await browser.newContext({ baseURL: origin });
  page = await independentContext.newPage();
  await startJoinInBrowser(page, independentEmail, { individual: true });
  const independent = page.getByRole("button", { name: "Continue as an individual", exact: true });
  await expect(independent).toBeVisible();
  await expect(page.getByText("Choose an organization only if you want to join it.", { exact: false })).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await independent.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`individual-choice-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await independent.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-join-application-form]")).toBeVisible();
  await expect(page.locator('[data-join-application-form] input[name="organizationName"]')).toBeHidden();
  // Joining signed them in, so the portal opens with the same session.
  await page.goto("/portal/#/home");
  const offer = page.getByRole("region", { name: "Your organization", exact: true });
  await expect(offer).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await offer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`shared-domain-offer-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await offer.getByRole("button", { name: "I am independent", exact: true }).click();
  await expect(offer).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await expect(offer).toHaveCount(0);

  await openMyProfile(page);
  await page.getByRole("button", { name: "Email addresses actions" }).click();
  await page.getByRole("menuitem", { name: "Add email address" }).click();
  // Independence dismissed both shared candidates; a new organization must still be offered.
  const aliasEmail = `independent-${suffix}@${later.email.split("@")[1]}`;
  await page.getByRole("textbox", { name: /^Email address/ }).fill(aliasEmail);
  const beforeAlias = await capturedEmailCount();
  await page.getByRole("button", { name: "Send verification link", exact: true }).click();
  const aliasProof = await waitForCapturedEmail(aliasEmail, "Verify your email address", { since: beforeAlias });
  await page.goto(extractEmailUrl(aliasProof, "/portal/"));
  await page.getByRole("button", { name: "Verify this address", exact: true }).click();
  await expect(page.getByText(`${aliasEmail} is verified`, { exact: true })).toBeVisible();
  await page.goto("/portal/#/home");
  const joinOrganization = offer.getByRole("button", { name: `Join Later Organization ${suffix}`, exact: true });
  await expect(joinOrganization).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await offer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`organization-after-dismissal-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await offer
    .getByRole("textbox", { name: ORGANIZATION_JOB_TITLE_COPY.label, exact: false })
    .fill("Security architect");
  await joinOrganization.click();
  await expect(offer).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await expect(offer).toHaveCount(0);
  await independentContext.close();
});

test("a verified address can apply for a nonmember organization on a shared domain", async ({ page }) => {
  const suffix = uniqueSuffix();
  await signInToPortal(page, e2eAdminEmail("shared-organization-domains"));
  const member = await createMember(page, { organizationName: `Shared Member ${suffix}` });
  const domain = member.email.split("@")[1]!;
  const name = `Shared Applicant ${suffix}`;
  const created = await page.request.post("/api/v1/organizations", { data: organizationCreateSchema.parse({ name }) });
  expect(created.status(), await created.text()).toBe(201);
  const organization = organizationCreateResponseSchema.parse(await created.json()).organization;
  const claim = await page.request.post(`/api/v1/organizations/${organization.id}/domains`, {
    data: { domain, reason: "Synthetic shared-domain membership test" },
  });
  expect(claim.status(), await claim.text()).toBe(201);
  await page.context().clearCookies();
  const email = `nonmember-${suffix}@${domain}`;
  await startJoinInBrowser(page, email);
  await page.getByRole("combobox", { name: "Organization (required)", exact: true }).selectOption({ label: name });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const organizationName = page.locator('[data-join-application-form] input[name="organizationName"]');
  await expect(organizationName).toHaveValue(name);
  await expect(organizationName).toHaveAttribute("readonly", "");
  await expect(page.locator("[data-join-application-form]")).toBeVisible();
  await page.getByLabel("First name", { exact: true }).fill("Casey");
  await page.getByLabel("Last name", { exact: true }).fill("Applicant");
  await page.getByLabel(/F —/).check();
  await page.getByLabel(/^Role or job title/).fill("Engineer");
  await page.getByLabel(/^Why do you want to join/).fill("Contribute to PKI interoperability.");
  await page.getByLabel(/^About yourself/).fill("I work on PKI standards.");
  await page.getByLabel(/^About your organization/).fill("We develop PKI services.");
  const agreements = page.locator('[data-join-application-form] input[type="checkbox"][required]');
  for (const agreement of await agreements.all()) await agreement.check();
  await page.route(
    "**/api/v1/members/applications",
    async (route) => {
      memberApplicationCreateSchema.parse(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "ORGANIZATION_AFFILIATION_CHANGED",
            message: "Confirm your organization again before applying.",
          },
        }),
      });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Submit membership application", exact: true }).click();
  const chooser = page.getByRole("combobox", { name: "Organization (required)", exact: true });
  await expect(chooser).toBeVisible();
  await expect(page.getByText("Confirm your organization again before applying.", { exact: true })).toBeVisible();
  await chooser.selectOption({ label: name });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue("Casey");
  await expect(page.getByLabel(/^Why do you want to join/)).toHaveValue("Contribute to PKI interoperability.");
  for (const agreement of await agreements.all()) await agreement.check();
  await page.getByRole("button", { name: "Submit membership application", exact: true }).click();
  await expect(page.getByRole("link", { name: /Check application status/ })).toBeVisible();
});

test("a verified address adds an organization on a dedicated subdomain", async ({ page }, info) => {
  const suffix = uniqueSuffix();
  await signInToPortal(page, e2eAdminEmail("shared-organization-domains"));
  const member = await createMember(page, { organizationName: `Subdomain Member ${suffix}` });
  const domain = member.email.split("@")[1]!;
  await page.context().clearCookies();
  const subdomain = `division.${domain}`;
  const email = `colleague-${suffix}@${subdomain}`;
  await startJoinInBrowser(page, email);
  await page.getByRole("button", { name: "Add organization", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add organization" });
  const domainChoice = dialog.getByRole("combobox", { name: /^Email domain/ });
  await expect(domainChoice).toHaveValue("");
  await domainChoice.selectOption(subdomain);
  await expect(
    dialog.getByText(`This organization will be linked to your verified email domain ${subdomain}.`),
  ).toBeVisible();
  const name = `New Division ${suffix}`;
  await dialog.getByRole("textbox", { name: /^Organization name/ }).fill(name);
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`add-organization-${device}.png`) });
  }
  await dialog.getByRole("button", { name: "Use organization", exact: true }).click();
  const form = page.locator("[data-join-application-form]");
  await expect(form.locator('input[name="organizationName"]')).toHaveValue(name);
  await page.reload();
  await expect(form.locator('input[name="organizationName"]')).toHaveValue(name);
});

test("a new organization chooses its domain when no organization is known", async ({ page }) => {
  const suffix = uniqueSuffix();
  const domain = `new-${suffix}.test`;
  const email = `person@division.${domain}`;
  await startJoinInBrowser(page, email);
  await page.getByRole("button", { name: "Add organization", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add organization" });
  await dialog.getByRole("combobox", { name: /^Email domain/ }).selectOption(domain);
  await expect(
    dialog.getByText(`This organization will be linked to your verified email domain ${domain}.`),
  ).toBeVisible();
  const name = `New Organization ${suffix}`;
  await dialog.getByRole("textbox", { name: /^Organization name/ }).fill(name);
  await dialog.getByRole("button", { name: "Use organization", exact: true }).click();
  await expect(page.locator('[data-join-application-form] input[name="organizationName"]')).toHaveValue(name);
});

test("another organization applies while the same domain has a pending application", async ({ page }) => {
  const suffix = uniqueSuffix();
  const domain = `pending-${suffix}.test`;
  await submitMembershipApplication(page, {
    email: `owner@${domain}`,
    name: "Pending Applicant",
    category: "F",
    organizationName: `Pending Organization ${suffix}`,
  });
  const email = `other@${domain}`;
  await startJoinInBrowser(page, email);
  await page.getByRole("button", { name: "Add organization", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add organization" });
  const name = `Different Organization ${suffix}`;
  await dialog.getByRole("textbox", { name: /^Organization name/ }).fill(name);
  const continuation = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/members/join/verify") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Use organization", exact: true }).click();
  const result = memberJoinVerifyResponseSchema.parse(await (await continuation).json());
  expect(result.status).toBe("application_ready");
  if (result.status !== "application_ready") throw new Error(`Unexpected ${result.status}`);
  await expect(page.locator('[data-join-application-form] input[name="organizationName"]')).toHaveValue(name);
  const submitted = await page.request.post("/api/v1/members/applications", {
    data: {
      applicantEmail: email,
      applicantName: "Different Applicant",
      membershipCategory: "F",
      organizationName: name,
      joinToken: result.joinToken,
      answers: {
        reason: "Synthetic shared-domain application",
        job_title: "Engineer",
        about_yourself: "Synthetic applicant",
        about_organization: "Synthetic organization",
        agrees_bylaws: true,
        agrees_code_of_conduct: true,
        agrees_ipr_policy: true,
        warranted_authority: true,
      },
    },
  });
  expect(submitted.status(), await submitted.text()).toBe(201);
});
