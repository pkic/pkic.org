import { completeSyntheticMembershipReview } from "./helpers/member-provisioning";
/**
 * Portal access for a member who actually became one.
 *
 * The persona suite proves the shell renders the right navigation for a given
 * set of capabilities, but it does so against intercepted API fixtures. This
 * journey takes a person all the way through join, review, and approval, then
 * signs them in for real, so the link between "approved applicant" and "member
 * who can use the portal" is exercised end to end rather than assumed.
 * @covers account.7.6
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { openEmailSignIn, signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, waitForCapturedEmail } from "./helpers/sendgrid";
import { ensureAppOrigin, submitMembershipApplication, uniqueSuffix } from "./helpers/membership";

test("an approved applicant can sign in to the portal as a member", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `approved-member-${suffix}@approved-member-${suffix}.test`;
  const name = `Approved Member ${suffix}`;
  page.on("dialog", (dialog) => void dialog.accept());

  const application = await submitMembershipApplication(page, {
    email,
    name,
    category: "F",
    organizationName: `Approved Member Organization ${suffix}`,
  });

  await signInToPortal(page, e2eAdminEmail("portal-member-access"));
  await completeSyntheticMembershipReview(page.request, application.applicationId);

  // Sign out of the staff identity completely: the member sign-in below must
  // establish its own session, not inherit staff capabilities.
  await page.context().clearCookies();
  await signInToPortal(page, email);

  // The identity is a member, not staff. Settings is the clearest
  // staff-only surface, so its absence is what distinguishes the two.
  const profile = await page.evaluate(async () => {
    const response = await fetch("/api/v1/users/current", { credentials: "same-origin" });
    return {
      status: response.status,
      body: (await response.json()) as { profile?: { email?: string }; email?: string },
    };
  });
  expect(profile.status, JSON.stringify(profile.body)).toBe(200);
  expect(profile.body.profile?.email ?? profile.body.email).toBe(email);

  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
});

test("a sign-in request for an unknown address creates no session", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `no-such-identity-${suffix}@no-such-identity-${suffix}.test`;
  await ensureAppOrigin(page);
  const since = await capturedEmailCount();

  await page.goto("/portal/");
  await openEmailSignIn(page);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();

  // The response must not disclose whether the address is known, so the same
  // reassurance is shown either way.
  await expect(page.getByText("you'll receive a sign-in link shortly", { exact: false })).toBeVisible();

  // What must differ is that no capability is actually issued and no session
  // exists. Poll the outbox briefly rather than trusting an immediate read.
  await expect
    .poll(
      async () => {
        try {
          await waitForCapturedEmail(email, "sign-in link", { since, timeoutMs: 3_000 });
          return "email-sent";
        } catch {
          return "no-email";
        }
      },
      { timeout: 12_000 },
    )
    .toBe("no-email");

  const session = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    return response.status;
  });
  expect(session, "an unknown address must not hold a portal session").toBe(401);
});
