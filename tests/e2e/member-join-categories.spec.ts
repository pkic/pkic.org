import { completeSyntheticMembershipReview } from "./helpers/member-provisioning";
/**
 * Membership joining across category kinds and domain outcomes.
 *
 * @covers join.1.1
 * @covers join.1.1.c
 *
 * The existing join journeys cover one organization application in category F
 * and one individual policy exception. The category vocabulary has fifteen
 * codes across two structurally different kinds, and the join decision has
 * three outcomes, so the parts that carry the actual policy — which categories
 * an applicant may even see, and whether a verified organization domain
 * continues into representative access instead of a second application — were
 * never exercised in a browser.
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { openMembershipVerificationLink, verifyMembershipJoinEmail } from "./helpers/member-join";
import { ensureAppOrigin, submitMembershipApplication, uniqueSuffix } from "./helpers/membership";

/** Reaches the rendered application form the way an applicant does. */
async function openVerifiedApplicationForm(
  page: Page,
  email: string,
  options: { unaffiliated?: boolean } = {},
): Promise<void> {
  const since = await capturedEmailCount();
  await page.goto("/join/");
  if (options.unaffiliated) {
    await page.getByLabel("No — I am not employed by and do not own an organization").check();
    await page.getByLabel("Your personal or university email address").fill(email);
  } else {
    await page.getByLabel("Yes — I am employed by or own an organization").check();
    await page.getByLabel("Your official work or organization email address").fill(email);
  }
  await page.getByRole("button", { name: "Continue" }).click();
  const verification = await waitForCapturedEmail(email, "Verify your email address", { since });
  await openMembershipVerificationLink(page, extractEmailUrl(verification, "#verify="));
  await expect(page.locator("[data-verified-application-email]")).toHaveText(email);
  await expect(page.locator('[data-membership-categories] input[name="category"]').first()).toBeVisible();
}

test("an organization applicant is offered only organization-tied categories", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `org-categories-${suffix}@org-categories-${suffix}.test`;

  await openVerifiedApplicationForm(page, email);

  const offered = await page
    .locator('[data-membership-categories] input[name="category"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

  expect(offered.length, "the catalog must offer organization categories").toBeGreaterThan(0);
  // The individual codes are the structural exception; an employed applicant
  // must not be able to pick one to sidestep their employer.
  expect(offered).not.toContain("H5");
  expect(offered).not.toContain("H6");
  expect(offered).not.toContain("H7");
  await expect(page.getByLabel("Organization name")).toBeVisible();
});

test("an individual applicant is offered only the org-less categories", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `individual-categories-${suffix}@university-${suffix}.test`;

  await openVerifiedApplicationForm(page, email, { unaffiliated: true });

  const offered = await page
    .locator('[data-membership-categories] input[name="category"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

  expect(offered.length).toBeGreaterThan(0);
  for (const code of offered) expect(["H5", "H6", "H7"]).toContain(code);
  await expect(page.getByLabel("Organization name")).toBeHidden();
});

test("an organization applicant submits in a category other than the default", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `category-a-${suffix}@category-a-${suffix}.test`;

  await openVerifiedApplicationForm(page, email);

  // Everything that provisions a fixture uses F. Submitting a different
  // organization category proves the choice is carried through rather than
  // the one well-trodden value happening to work.
  const offered = await page
    .locator('[data-membership-categories] input[name="category"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  const chosen = offered.find((code) => code !== "F") ?? offered[0];

  const reason = page.locator('[name="custom.reason"]');
  await reason.fill("We want to contribute to the PKI community.");
  await page.locator(`#membership-category-${chosen.toLowerCase()}`).check();
  await expect(reason).toHaveValue("We want to contribute to the PKI community.");
  const applicationForm = page.locator("[data-join-application-form]");
  const formWidth = (await applicationForm.boundingBox())!.width;
  expect((await reason.boundingBox())!.width).toBeGreaterThan(formWidth * 0.9);
  for (const document of await page.locator(".membership-legal-card").all()) {
    expect((await document.boundingBox())!.width).toBeGreaterThan(formWidth * 0.9);
  }
  await page.getByLabel("First name").fill("Alex");
  await page.getByLabel("Last name").fill("Applicant");
  await page.getByLabel("Organization name").fill(`Category ${chosen} Organization ${suffix}`);
  for (const agreement of await page.locator('[data-join-application-form] input[type="checkbox"][required]').all()) {
    await agreement.check();
  }

  const submission = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/members/applications") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Submit membership application" }).click();
  expect((await submission).status()).toBe(201);
  await expect(page.getByRole("heading", { name: /Thanks, Alex Applicant!/ })).toBeVisible();
});

test("a personal address cannot start an organization application without the explicit attestation", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const email = `personal-${suffix}@gmail.com`;

  await ensureAppOrigin(page);
  const outcome = await page.evaluate(async (address) => {
    const response = await fetch("/api/v1/members/join/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: address, unaffiliatedAttestation: false }),
    });
    return { status: response.status, body: await response.json() };
  }, email);

  // The policy is an explicit attestation, never inferred from picking an
  // easier category later in the form.
  expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
  expect(outcome.body).toEqual({ status: "unaffiliated_attestation_required" });
});

test("a verified claimed domain continues into organization access without a second application", async ({ page }) => {
  const suffix = uniqueSuffix();
  const domain = `claimed-${suffix}.test`;
  const founderEmail = `founder-${suffix}@${domain}`;
  const colleagueEmail = `colleague-${suffix}@${domain}`;

  // The first applicant's submission claims the domain; approval transfers
  // that claim to the created organization.
  const application = await submitMembershipApplication(page, {
    email: founderEmail,
    name: `Founder ${suffix}`,
    category: "F",
    organizationName: `Claimed Domain Organization ${suffix}`,
  });

  page.on("dialog", (dialog) => void dialog.accept());
  await signInToPortal(page, e2eAdminEmail("portal-join-categories"));

  await completeSyntheticMembershipReview(page.request, application.applicationId);

  /*
   * A colleague at the same verified domain is recognized as belonging to the
   * organization that already holds the membership, not routed into a second
   * application — which is what #27 asked to be sure of: "those users can
   * automatically be admitted as a member under that organization if
   * verified. Ensure we have a test for this."
   *
   * The status alone would not show it. What matters is the outcome: they are
   * admitted under THAT organization, they arrive with a working session, and
   * no second application exists for a company the consortium already has.
   */
  await page.context().clearCookies();
  await ensureAppOrigin(page);
  const join = await verifyMembershipJoinEmail(page, colleagueEmail);
  expect(join.status).toBe("organization_access_ready");
  if (join.status !== "organization_access_ready") throw new Error("Expected organization access");
  // The membership they were admitted under is the founder's organization,
  // named on the capacity they now act in.
  expect(join.member.activeIdentities.map((identity) => identity.organizationName)).toContain(
    `Claimed Domain Organization ${suffix}`,
  );

  /*
   * And it is a real session, not a claim about one: the portal opens, and
   * the record it opens says which organization they represent. A colleague
   * who is "admitted" but cannot get in has not been admitted.
   */
  await page.goto("/portal/");
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);

  const current = await page.evaluate(async () => {
    const response = await fetch("/api/v1/users/current", { credentials: "same-origin" });
    return { status: response.status, body: (await response.json()) as { organizationName?: string | null } };
  });
  expect(current.status, JSON.stringify(current.body)).toBe(200);
  expect(current.body.organizationName).toBe(`Claimed Domain Organization ${suffix}`);

  // No duplicate application was filed for an organization already admitted.
  await page.context().clearCookies();
  await signInToPortal(page, e2eAdminEmail("portal-join-categories"));
  const applications = await page.evaluate(async (organizationName) => {
    const response = await fetch(`/api/v1/members/applications?q=${encodeURIComponent(organizationName)}`, {
      credentials: "same-origin",
    });
    const body = (await response.json()) as { applications?: unknown[] };
    return { status: response.status, count: body.applications?.length ?? 0 };
  }, `Claimed Domain Organization ${suffix}`);
  expect(applications.status).toBe(200);
  expect(applications.count).toBe(1);
});
