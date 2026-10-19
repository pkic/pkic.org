/** @covers account.7.1 */
import { test, expect } from "@playwright/test";
import { openEmailSignIn } from "./helpers/portal-auth";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 1366 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
]) {
  test(`login fills the page without a gap below its side panel at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/portal/");
    await openEmailSignIn(page);
    await expect(page.getByRole("link", { name: "Ask the secretariat" })).toHaveAttribute(
      "href",
      "mailto:contact@pkic.org",
    );
    const layout = await page.evaluate(() => {
      const login = document.querySelector(".pk-login")!.getBoundingClientRect();
      const backdrop = document.querySelector(".pk-login__backdrop")!.getBoundingClientRect();
      const footer = document.querySelector("footer")!.getBoundingClientRect();
      return {
        loginLeft: login.left,
        loginRight: login.right,
        viewportWidth: document.documentElement.clientWidth,
        loginTop: login.top,
        headerBottom: document.querySelector("#pkicMainNav")!.getBoundingClientRect().bottom,
        loginBottom: login.bottom,
        backdropBottom: backdrop.bottom,
        footerTop: footer.top,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(layout.overflow).toBe(0);
    expect(layout.loginLeft).toBe(0);
    expect(Math.abs(layout.loginRight - layout.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.loginTop - layout.headerBottom)).toBeLessThanOrEqual(1);
    if (viewport.width >= 1024) {
      await expect(page.getByText("Working group drafts, votes, plenary registration", { exact: false })).toBeVisible();
      await expect(page.locator(".pk-login__facts")).toBeVisible();
    }
    expect(Math.abs(layout.footerTop - layout.loginBottom)).toBeLessThanOrEqual(1);
    if (viewport.width >= 1024) expect(Math.abs(layout.backdropBottom - layout.loginBottom)).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: test.info().outputPath(`login-${viewport.width}.png`),
      fullPage: true,
    });
  });
}

test("an expired administrator elevation keeps member access and offers a fresh sign-in", async ({ page }) => {
  const { signInToPortal } = await import("./helpers/portal-auth");
  const { e2eAdminEmail } = await import("../helpers/e2e-admin");
  const { userAuthSessionResponseSchema, userAuthRequestSchema } =
    await import("../../assets/shared/schemas/user-auth");
  const { organizationCreateSchema, organizationCreateResponseSchema } =
    await import("../../assets/shared/schemas/organization-management");
  await page.clock.install();
  const email = e2eAdminEmail("portal-login-layout-expiry");
  await signInToPortal(page, email);
  // Administrator grants alone convey no membership. Establish the independent
  // member capacity this expiry scenario promises through the real staff command.
  const memberInput = organizationCreateSchema.parse({
    name: `Elevation expiry member ${Date.now()}`,
    membershipCategory: "F",
    memberSince: "2026-01-15",
    identities: [{ name: "Elevation expiry representative", email, jobTitle: "Delegate" }],
    activationReason: "Synthetic member and administrator capacity expiry coverage",
  });
  const created = await page.evaluate(async (body) => {
    const response = await fetch("/api/v1/organizations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, memberInput);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const organization = organizationCreateResponseSchema.parse(created.body).organization;
  expect(organization.identities).toEqual(
    expect.arrayContaining([expect.objectContaining({ email, state: "active" })]),
  );
  await page.context().clearCookies();
  await page.reload();
  await signInToPortal(page, email);
  await page.goto("/portal/#/organizations");
  await expect(page.getByRole("heading", { name: "Organizations", exact: true })).toBeVisible();
  const response = await page.request.get("/api/v1/auth/session");
  expect(response.status()).toBe(200);
  const session = userAuthSessionResponseSchema.parse(await response.json());
  expect(session.member).toBeDefined();
  expect(session.staff).toBeDefined();
  const staff = session.staff;
  if (!staff?.expiresAt || !staff.idleExpiresAt) throw new Error("Expected a staff elevation with both deadlines");
  const deadline = Math.min(Date.parse(staff.expiresAt), Date.parse(staff.idleExpiresAt));
  const memberDeadline = Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt));
  expect(deadline + 2000).toBeLessThan(memberDeadline);
  const browserNow = await page.evaluate(() => Date.now());
  await page.clock.fastForward(Math.max(0, deadline - browserNow) + 2000);
  await expect(page.getByRole("alert")).toContainText("Administrator access expired");
  await expect(page.getByText("You are still signed in with your other portal access.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organizations", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out and sign in again" }).click();
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
  // Intentional sign-out clears the old recovery key; the current hash is the
  // canonical destination carried by the next sign-in request.
  await expect(page).toHaveURL(/\/portal\/#\/organizations$/);
  await openEmailSignIn(page);
  await page.getByLabel("Work email").fill(email);
  const nextSignIn = page.waitForResponse(
    (result) => new URL(result.url()).pathname === "/api/v1/auth/request-link" && result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const requested = await nextSignIn;
  expect(requested.status()).toBe(200);
  expect(userAuthRequestSchema.parse(requested.request().postDataJSON())).toMatchObject({
    email,
    returnPath: "/organizations",
  });
  await expect(page.getByText("you'll receive a sign-in link shortly", { exact: false })).toBeVisible();
});
