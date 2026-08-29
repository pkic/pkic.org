/**
 * The portal sign-in capability, from the attacker's side.
 *
 * The browser suite covers single-use and expiry for registration and proposal
 * tokens, but the portal's own email capability — the one that hands out a
 * staff or member session — had no such coverage. A capability that could be
 * replayed, or that stayed in the URL and therefore in history, would be a
 * session-handover bug that every functional journey still passes.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { ensureAppOrigin, uniqueSuffix } from "./helpers/membership";

/** Requests one sign-in link and returns the URL from the delivered mail. */
async function requestSignInLink(page: import("@playwright/test").Page, email: string): Promise<string> {
  await page.goto("/portal/");
  await expect(page.locator("#portal-inp-email")).toBeVisible({ timeout: 10_000 });
  await page.locator("#portal-inp-email").fill(email);
  const since = await capturedEmailCount();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const message = await waitForCapturedEmail(email, "sign-in link", { since });
  return extractEmailUrl(message, "/portal/");
}

test("the sign-in capability is single-use and cannot be replayed", async ({ page, context }) => {
  const email = e2eAdminEmail("portal-identity-security");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": `2001:db8::9a${uniqueSuffix().slice(-4)}` });

  const link = await requestSignInLink(page, email);

  await page.goto(link);
  await page.reload();
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#portal-inp-email")).toHaveCount(0);

  // The same link, in a browser that never held a session. Redeeming a
  // capability twice must not produce a second one.
  const replayPage = await context
    .browser()!
    .newContext()
    .then((c) => c.newPage());
  await replayPage.goto(link);
  await replayPage.reload();
  await expect(replayPage.locator("#portal-inp-email")).toBeVisible({ timeout: 15_000 });
  const replaySession = await replayPage.evaluate(async () => {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    return response.status;
  });
  expect(replaySession, "a replayed capability must not create a session").toBe(401);
  await replayPage.context().close();
});

test("the capability is removed from the address bar and not left in history", async ({ page }) => {
  const email = e2eAdminEmail("portal-identity-history");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": `2001:db8::9b${uniqueSuffix().slice(-4)}` });

  const link = await requestSignInLink(page, email);
  const capability = new URL(link).hash;
  expect(capability, "the sign-in mail must carry a capability fragment").toContain("verify");

  await page.goto(link);
  await page.reload();
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });

  // The token must not survive in the address bar, where it would be shoulder
  // -surfable, copied into a bug report, or synced to another device.
  expect(page.url()).not.toContain("verify=");
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).not.toContain("verify=");

  // Nor may stepping back land on a URL that still carries it.
  await page.goBack().catch(() => undefined);
  expect(page.url()).not.toContain("verify=");
});

test("signing out revokes the session rather than only clearing the view", async ({ page }) => {
  const email = e2eAdminEmail("portal-identity-logout");
  await signInToPortal(page, email);

  const before = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    return response.status;
  });
  expect(before).toBe(200);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#portal-inp-email")).toBeVisible({ timeout: 15_000 });

  // A cleared UI is not a revoked session: ask the API directly.
  const after = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    return response.status;
  });
  expect(after, "sign out must revoke the session, not just the rendered state").toBe(401);
});

test("a membership join capability cannot be redeemed as a portal sign-in", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `wrong-purpose-${suffix}@wrong-purpose-${suffix}.test`;
  await ensureAppOrigin(page);

  // Start a join flow to obtain a capability issued for a different purpose.
  const since = await capturedEmailCount();
  const started = await page.evaluate(async (address) => {
    const response = await fetch("/api/v1/members/join/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: address, unaffiliatedAttestation: false }),
    });
    return response.status;
  }, email);
  expect(started).toBe(200);

  const message = await waitForCapturedEmail(email, "Verify your email address", { since });
  const joinUrl = extractEmailUrl(message, "/join/");
  const joinToken = new URLSearchParams(new URL(joinUrl).hash.slice(1)).get("verify");
  expect(joinToken).toBeTruthy();

  // Present it where a portal sign-in capability is expected.
  await page.goto(`/portal/#verify=${encodeURIComponent(joinToken!)}`);
  await page.reload();
  await expect(page.locator("#portal-inp-email")).toBeVisible({ timeout: 15_000 });
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    return response.status;
  });
  expect(session, "a join capability must not authenticate a portal session").toBe(401);
});
