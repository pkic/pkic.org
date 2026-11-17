/** Returning members should reach sign-in, not another application. @covers join.1.0 */
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNT_ORGANIZATION_COPY } from "../../assets/shared/account-organization-copy";
import { memberApplicationCreateAsIdentitySchema } from "../../assets/shared/schemas/member-applications";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../assets/shared/email-first-copy";
import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import {
  applyAsOrganizationIdentity,
  approveMemberThroughReview,
  submitMembershipApplication,
  uniqueSuffix,
} from "./helpers/membership";
import { addMissingName, addRepresentationBio } from "./helpers/person-details";
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

/** Adds `address` to the signed-in person's account and opens its verification link. */
async function addVerifiedAddress(page: Page, address: string): Promise<void> {
  await openMyProfile(page);
  await page.getByRole("button", { name: "Email addresses actions" }).click();
  await page.getByRole("menuitem", { name: "Add email address" }).click();
  await page.getByRole("textbox", { name: /^Email address/ }).fill(address);
  const before = await capturedEmailCount();
  await page.getByRole("button", { name: "Send verification link", exact: true }).click();
  const proof = await waitForCapturedEmail(address, "Verify your email address", { since: before });
  await page.goto(extractEmailUrl(proof, "/portal/"));
  await page.getByRole("button", { name: "Verify this address", exact: true }).click();
  await expect(page.getByText(`${address} is verified`, { exact: true })).toBeVisible();
}

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

test("a verified address on a shared domain represents the member organization it chooses", async ({
  page: staff,
  browser,
}) => {
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

  // Each person arrives in a browser of their own.
  const origin = new URL(staff.url()).origin;
  const colleagueContext = await browser.newContext({ baseURL: origin });
  try {
    page = await colleagueContext.newPage();
    const email = `colleague-${suffix}@${domain}`;
    // Account setup asks which of the domain's organizations they represent.
    await startJoinInBrowser(page, email, {
      organization: {
        name: `Shared Second ${suffix}`,
        inspect: async (step) => {
          await expect(step.getByText(ACCOUNT_ORGANIZATION_COPY.claimedIntro(domain), { exact: true })).toBeVisible();
          const choice = step.getByLabel(/^Organization\b(?! name)/);
          const offered = await choice.locator("option").allTextContents();
          for (const name of [`Shared First ${suffix}`, `Shared Second ${suffix}`])
            expect(offered.some((option) => option.startsWith(name))).toBe(true);
          expect(offered.some((option) => option.startsWith(`Later Organization ${suffix}`))).toBe(false);
          for (const [width, device] of [
            [1280, "desktop"],
            [375, "phone"],
          ] as const) {
            await page.setViewportSize({ width, height: 812 });
            await choice.scrollIntoViewIfNeeded();
            await page.screenshot({ path: test.info().outputPath(`shared-organization-${device}.png`) });
          }
          await page.setViewportSize({ width: 1280, height: 800 });
        },
      },
    });
    // Choosing the organization makes them its representative, so the join page says no application is needed.
    await expect(
      page.getByRole("heading", { name: `Shared Second ${suffix} is already a member`, exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-join-application-form]")).toBeHidden();
  } finally {
    await colleagueContext.close();
  }
  const independentContext = await browser.newContext({ baseURL: origin });
  try {
    page = await independentContext.newPage();
    // On a domain organizations have claimed, an individual applies from a personal address.
    await startJoinInBrowser(page, `independent-${suffix}@gmail.com`, { individual: true });
    await expect(page.locator("[data-join-application-form]")).toBeVisible();
    await expect(page.locator('[data-join-application-form] input[name="organizationName"]')).toBeHidden();
    // Joining signed them in, so the portal opens with the same session. A work address added there offers its organizations.
    await addVerifiedAddress(page, `independent-${suffix}@${domain}`);
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

    // Independence dismissed both shared candidates; a new organization must still be offered.
    await addVerifiedAddress(page, `independent-${suffix}@${later.email.split("@")[1]}`);
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
  } finally {
    await independentContext.close();
  }
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
  await startJoinInBrowser(page, email, { organization: { name } });
  // The application is made as the identity added at account setup, never a typed name.
  const applicant = page.locator("[data-join-signed-in]");
  await expect(applicant).toContainText(name);
  await expect(page.getByLabel("Organization name")).toHaveCount(0);
  await expect(page.locator("[data-join-application-form]")).toBeVisible();
  await addMissingName(page, applicant, { firstName: "Casey", lastName: "Applicant" });
  await addRepresentationBio(page, applicant, "I work on PKI standards.");
  await page.getByLabel(/F —/).check();
  await page.getByLabel(/^Why do you want to join/).fill("Contribute to PKI interoperability.");
  await page.getByLabel(/^About your organization/).fill("We develop PKI services.");
  const agreements = page.locator('[data-join-application-form] input[type="checkbox"][required]');
  for (const agreement of await agreements.all()) await agreement.check();
  await page.route(
    "**/api/v1/members/applications",
    async (route) => {
      memberApplicationCreateAsIdentitySchema.parse(route.request().postDataJSON());
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
  // The refusal is said and the answers stay, so the application can be sent again.
  await expect(page.getByText("Confirm your organization again before applying.", { exact: true })).toBeVisible();
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
  const name = `New Division ${suffix}`;
  // Beside the parent domain's member, account setup adds the division on its own subdomain.
  await startJoinInBrowser(page, email, {
    organization: {
      name,
      domain: subdomain,
      inspect: async (adding) => {
        await expect(
          adding.getByText(`This organization will be linked to your verified email domain ${subdomain}.`),
        ).toBeVisible();
        for (const [width, height, device] of [
          [1280, 900, "desktop"],
          [375, 812, "phone"],
        ] as const) {
          await page.setViewportSize({ width, height });
          await page.screenshot({ path: info.outputPath(`add-organization-${device}.png`) });
        }
        await page.setViewportSize({ width: 1280, height: 900 });
      },
    },
  });
  const applicant = page.locator("[data-join-signed-in]");
  await expect(applicant).toContainText(name);
  await expect(page.locator("[data-join-application-form]")).toBeVisible();
  await page.reload();
  await expect(applicant).toContainText(name);
});

test("a new organization chooses its domain when no organization is known", async ({ page }) => {
  const suffix = uniqueSuffix();
  const domain = `new-${suffix}.test`;
  const email = `person@division.${domain}`;
  const name = `New Organization ${suffix}`;
  await startJoinInBrowser(page, email, {
    organization: {
      name,
      domain,
      inspect: async (step) => {
        await expect(
          step.getByText(`This organization will be linked to your verified email domain ${domain}.`),
        ).toBeVisible();
      },
    },
  });
  await expect(page.locator("[data-join-signed-in]")).toContainText(name);
  await expect(page.locator("[data-join-application-form]")).toBeVisible();
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
  const name = `Different Organization ${suffix}`;
  // Another organization on the same domain is added at account setup and applies beside the pending one.
  await startJoinInBrowser(page, email, { organization: { name } });
  await expect(page.locator("[data-join-signed-in]")).toContainText(name);
  await expect(page.locator("[data-join-application-form]")).toBeVisible();
  await applyAsOrganizationIdentity(page.request, {
    email,
    name: "Different Applicant",
    category: "F",
    organizationName: name,
  });
});
