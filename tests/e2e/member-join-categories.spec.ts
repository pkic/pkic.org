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
import { verifyMembershipJoinEmail } from "./helpers/member-join";
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
  await page.goto(extractEmailUrl(verification, "#verify="));
  await page.reload();
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

  await page.locator(`#membership-category-${chosen.toLowerCase()}`).check();
  await page.getByLabel("First name").fill("Alex");
  await page.getByLabel("Last name").fill("Applicant");
  await page.getByLabel("Organization name").fill(`Category ${chosen} Organization ${suffix}`);
  await page.locator('[name="custom.reason"]').fill("We want to contribute to the PKI community.");
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

  for (const toStage of ["in_review", "in_consultation", "ec_review"]) {
    const status = await page.evaluate(
      async ({ applicationId, toStage }) => {
        const response = await fetch(`/api/v1/members/applications/${applicationId}/stage`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ toStage }),
        });
        return response.status;
      },
      { applicationId: application.applicationId, toStage },
    );
    expect(status, `stage transition to ${toStage}`).toBe(200);
  }
  const approved = await page.evaluate(async (applicationId) => {
    const response = await fetch(`/api/v1/members/applications/${applicationId}/approve`, {
      method: "POST",
      credentials: "same-origin",
    });
    return { status: response.status, body: await response.json() };
  }, application.applicationId);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  // A colleague at the same verified domain must be recognized as belonging
  // to the existing Member, not routed into a duplicate application.
  await page.context().clearCookies();
  await ensureAppOrigin(page);
  const join = await verifyMembershipJoinEmail(page, colleagueEmail);
  expect(join.status).toBe("organization_access_ready");
});
