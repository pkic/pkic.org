/** @covers account.7.1 */
import { test, expect } from "@playwright/test";
import { openEmailSignIn } from "./helpers/portal-auth";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 1366 },
  { width: 1920, height: 1080 },
  { width: 375, height: 812 },
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

test("an expired administrator elevation ends the whole portal session and offers a fresh sign-in", async ({
  page,
}) => {
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
  // A session acts as one identity, and membership belongs to the identity it acts as.
  // The administrator also holds an individual identity, so the person chooses the member's.
  const memberIdentity = organization.identities.find((identity) => identity.email === email);
  expect(memberIdentity).toBeDefined();
  const selected = await page.request.put("/api/v1/users/current/identities/active", {
    data: { identityId: memberIdentity!.identityId },
  });
  expect(selected.status(), await selected.text()).toBe(200);
  const response = await page.request.get("/api/v1/auth/session");
  expect(response.status()).toBe(200);
  const session = userAuthSessionResponseSchema.parse(await response.json());
  expect(session.member, JSON.stringify(session.actingIdentities)).toBeDefined();
  expect(session.staff).toBeDefined();
  const staff = session.staff;
  if (!staff?.expiresAt || !staff.idleExpiresAt) throw new Error("Expected a staff elevation with both deadlines");
  const deadline = Math.min(Date.parse(staff.expiresAt), Date.parse(staff.idleExpiresAt));
  const memberDeadline = Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt));
  expect(deadline + 2000).toBeLessThan(memberDeadline);
  const browserNow = await page.evaluate(() => Date.now());
  await page.clock.fastForward(Math.max(0, deadline - browserNow) + 2000);
  // Staff access ending ends the whole portal session, even for a person who also holds member access.
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organizations", exact: true })).toHaveCount(0);
  // The expired session keeps the current hash as the destination carried by the next sign-in request.
  await expect(page).toHaveURL(/\/portal\/#\/organizations$/);
  await openEmailSignIn(page);
  await page.getByLabel("Email").fill(email);
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

test.describe("client release recovery", () => {
  // Missing-file simulations must reach the browser routes rather than the offline cache.
  test.use({ serviceWorkers: "block" });
  test("an idle portal refreshes once after a deployment and preserves its location", async ({ page }) => {
    await page.clock.install();
    await page.goto("/portal/#/home?appearance=dark");
    await expect(
      page
        .getByRole("button", { name: "Sign in", exact: true })
        .or(page.getByRole("button", { name: "Sign in with a passkey", exact: true })),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with a passkey", exact: true })).toBeEnabled();
    let shellRequests = 0;
    await page.route("**/portal/", async (route) => {
      if (route.request().isNavigationRequest()) return route.continue();
      shellRequests += 1;
      await route.fulfill({
        contentType: "text/html",
        body: '<script type="module" src="/_assets/portal.next-release.js"></script>',
      });
    });
    await page.clock.fastForward(16_000);
    const reloaded = page.waitForEvent("domcontentloaded", { timeout: 15_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError")));
    await reloaded;
    await expect(page).toHaveURL(/#\/home\?appearance=dark$/);
    await page.clock.fastForward(300_000);
    expect(shellRequests).toBeGreaterThan(0);
    // Returning the stale shell again cannot cause another automatic reload.
    let extraNavigations = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest()) extraNavigations += 1;
    });
    await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError")));
    await page.clock.fastForward(30_000);
    expect(extraNavigations).toBe(0);
  });

  test("a deployment does not discard an edited sign-in form", async ({ page }) => {
    await page.clock.install();
    await page.goto("/portal/");
    await openEmailSignIn(page);
    await page.getByLabel("Email").fill("release-recovery@example.test");
    await page.route("**/portal/", async (route) => {
      if (route.request().isNavigationRequest()) return route.continue();
      await route.fulfill({
        contentType: "text/html",
        body: '<script type="module" src="/_assets/portal.next-release.js"></script>',
      });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError")));
    await page.clock.fastForward(600_000);
    await expect(page.getByLabel("Email")).toHaveValue("release-recovery@example.test");
  });

  test("a missing lazy view offers recovery without removing portal navigation", async ({ page }) => {
    const { signInToPortal } = await import("./helpers/portal-auth");
    const { e2eAdminEmail } = await import("../helpers/e2e-admin");
    await page.route(/\/(?:chunks\/)?Home(?:\.[^/?]+)?\.js(?:\?.*)?$/, (route) => route.abort());
    await signInToPortal(page, e2eAdminEmail("portal-release-recovery"));
    await expect(page.getByRole("button", { name: "Reload page", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu", exact: true })).toBeVisible();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("button", { name: "Reload page", exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`release-recovery-${width}.png`), fullPage: true });
    }
  });
});

test("public interactive pages recover through the shared loader", async ({ page }) => {
  const shell = await page.request.get("/sessions/");
  const etag = shell.headers().etag;
  expect(etag).toBeTruthy();
  expect(shell.headers()["cache-control"]).toMatch(/must-revalidate|no-cache/);
  const unchanged = await page.request.get("/sessions/", { headers: { "If-None-Match": etag } });
  expect(unchanged.status()).toBe(304);
  await page.goto("/sessions/");
  const scripts = await page
    .locator('script[type="module"][src]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("src")!));
  const script = await page.request.get(scripts.find((src) => src.startsWith("/_assets/"))!);
  expect(script.headers()["cache-control"]).toContain("immutable");
  await expect(page.getByRole("heading", { name: "Session archive", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-client-release-recovery", "");
  await page.clock.install();
  await page.route("**/sessions/", async (route) => {
    if (route.request().isNavigationRequest()) return route.continue();
    await route.fulfill({
      contentType: "text/html",
      body: '<script type="module" src="/_assets/site.next-release.js"></script>',
    });
  });
  await page.clock.fastForward(16_000);
  const reloaded = page.waitForEvent("domcontentloaded", { timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError")));
  await reloaded;
  await expect(page.getByRole("heading", { name: "Session archive", exact: true })).toBeVisible();
});
