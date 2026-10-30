/**
 * The portal sign-in capability, from the attacker's side.
 *
 * The browser suite covers single-use and expiry for registration and proposal
 * tokens, but the portal's own email capability — the one that hands out a
 * staff or member session — had no such coverage. A capability that could be
 * replayed, or that stayed in the URL and therefore in history, would be a
 * session-handover bug that every functional journey still passes.
 * @covers account.7.2
 * @covers account.7.3
 * @covers account.7.4
 * @covers account.7.5
 */
import { expect, test } from "@playwright/test";
import {
  ownEmailVerificationRequestedResponseSchema,
  ownEmailAddressUpdateSchema,
  ownEmailAddressesListResponseSchema,
} from "../../assets/shared/schemas/own-email-addresses";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { declinePasskeyOffer, openEmailSignIn, openMyProfile, signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { ensureAppOrigin, uniqueSuffix } from "./helpers/membership";

/** Requests one sign-in link and returns the URL from the delivered mail. */
async function requestSignInLink(page: import("@playwright/test").Page, email: string): Promise<string> {
  await page.goto("/portal/");
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible({ timeout: 10_000 });
  await openEmailSignIn(page);
  await page.getByLabel("Email").fill(email);
  const since = await capturedEmailCount();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const message = await waitForCapturedEmail(email, "sign-in link", { since });
  return extractEmailUrl(message, "/portal/");
}

/**
 * Opens a sign-in capability the way a person opens it from their mail: as a fresh page load.
 *
 * From the portal itself, the link is a hash-only navigation that does not rerun the one-time verifier, and a reload
 * on top of it can cancel the first redemption so that the second is refused as already used. Leaving the document
 * first loads the link once, and the redemption's own response is the condition to wait for.
 */
async function openSignInLink(page: import("@playwright/test").Page, link: string) {
  await page.goto("about:blank");
  const redeemed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/auth/verify-link" && response.request().method() === "POST",
  );
  await page.goto(link);
  return redeemed;
}

test("sign-in capabilities require address permission, revoke with it, and cannot be replayed", async ({
  page,
  context,
}) => {
  const email = e2eAdminEmail("portal-identity-security");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": `2001:db8::9a${uniqueSuffix().slice(-4)}` });

  const link = await requestSignInLink(page, email);

  const redeemed = await openSignInLink(page, link);
  expect(redeemed.status(), await redeemed.text()).toBe(200);
  await declinePasskeyOffer(page);
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);

  // The same link, in a browser that never held a session. Redeeming a
  // capability twice must not produce a second one.
  const replayPage = await context
    .browser()!
    .newContext()
    .then((c) => c.newPage());
  const replayed = await openSignInLink(replayPage, link);
  expect(replayed.ok(), "a used capability must be refused").toBe(false);
  await expect(replayPage.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible({ timeout: 15_000 });
  const replaySession = await replayPage.evaluate(async () => {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    return response.status;
  });
  expect(replaySession, "a replayed capability must not create a session").toBe(401);
  await replayPage.context().close();

  // Proving another mailbox does not grant it account sign-in.
  await openMyProfile(page);
  const owner = userAuthSessionResponseSchema.parse(await (await page.request.get("/api/v1/auth/session")).json());
  const aliasEmail = `address-permission-${uniqueSuffix()}@example.test`;
  await page.getByRole("button", { name: "Email addresses actions" }).click();
  await page.getByRole("menuitem", { name: "Add email address" }).click();
  await page.getByRole("textbox", { name: /^Email address/ }).fill(aliasEmail);
  const since = await capturedEmailCount();
  const addedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/users/current/emails" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send verification link", exact: true }).click();
  const requested = ownEmailVerificationRequestedResponseSchema.parse(await (await addedResponse).json());
  expect(requested.status).toBe("verification_sent");
  const pending = ownEmailAddressesListResponseSchema.parse(
    await (await page.request.get("/api/v1/users/current/emails")).json(),
  );
  expect(pending.emails.some((address) => address.email === aliasEmail)).toBe(false);
  const verification = await waitForCapturedEmail(aliasEmail, "Verify your email address", { since });
  const proofPage = await context.newPage();
  await proofPage.goto(extractEmailUrl(verification, "/portal/"));
  await proofPage.getByRole("button", { name: "Verify this address", exact: true }).click();
  await expect(proofPage.getByText(`${aliasEmail} is verified`, { exact: true })).toBeVisible();
  await proofPage.close();
  const addresses = ownEmailAddressesListResponseSchema.parse(
    await (await page.request.get("/api/v1/users/current/emails")).json(),
  );
  const added = addresses.emails.find((address) => address.email === aliasEmail)!;
  expect(added).toMatchObject({
    verifiedAt: expect.any(String),
    signInEnabled: false,
  });

  // The account owner separately enables sign-in through the canonical address update contract.
  const path = `/api/v1/users/current/emails/${added.id}`;
  const enabled = await page.request.patch(path, { data: ownEmailAddressUpdateSchema.parse({ signInEnabled: true }) });
  expect(enabled.status()).toBe(200);
  const aliasContext = await context.browser()!.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const aliasPage = await aliasContext.newPage();
    await signInToPortal(aliasPage, aliasEmail);
    const aliasSession = userAuthSessionResponseSchema.parse(
      await (await aliasPage.request.get("/api/v1/auth/session")).json(),
    );
    expect(aliasSession.identity.id).toBe(owner.identity.id);
    const disabled = await page.request.patch(path, {
      data: ownEmailAddressUpdateSchema.parse({ signInEnabled: false }),
    });
    expect(disabled.status()).toBe(200);
    expect((await aliasPage.request.get("/api/v1/auth/session")).status()).toBe(401);
    expect((await page.request.get("/api/v1/auth/session")).status()).toBe(200);
  } finally {
    await aliasContext.close();
  }
  const removed = await page.request.delete(path);
  expect(removed.status(), await removed.text()).toBe(200);
});

test("the capability is removed from the address bar and not left in history", async ({ page }) => {
  const email = e2eAdminEmail("portal-identity-history");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": `2001:db8::9b${uniqueSuffix().slice(-4)}` });

  const link = await requestSignInLink(page, email);
  const capability = new URL(link).hash;
  expect(capability, "the sign-in mail must carry a capability fragment").toContain("verify");

  const redeemed = await openSignInLink(page, link);
  expect(redeemed.status(), await redeemed.text()).toBe(200);
  await declinePasskeyOffer(page);

  // The token must not survive in the address bar, where it would be shoulder
  // -surfable, copied into a bug report, or synced to another device.
  expect(page.url()).not.toContain("verify=");
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).not.toContain("verify=");

  // Nor may stepping back land on a URL that still carries it.
  await page.goBack().catch(() => undefined);
  expect(page.url()).not.toContain("verify=");
});

for (const withoutRandomUUID of [false, true]) {
  test(`signing out revokes the session ${withoutRandomUUID ? "without crypto.randomUUID" : "with crypto.randomUUID"}`, async ({
    page,
  }) => {
    if (withoutRandomUUID) {
      // Network HTTP origins expose getRandomValues but omit the secure-context UUID API.
      await page.addInitScript(() => Object.defineProperty(crypto, "randomUUID", { value: undefined }));
    }
    const email = e2eAdminEmail("portal-identity-logout");
    await signInToPortal(page, email);

    const before = await page.evaluate(async () => {
      const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
      return response.status;
    });
    expect(before).toBe(200);
    const originalCookies = (await page.context().cookies()).map(({ name, value }) => `${name}=${value}`).join("; ");

    // Sign out now lives in the sidebar footer's account menu rather than as a
    // standalone button.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible({ timeout: 15_000 });
    // The device signs out first and then ends the session on the server; the notice changes once the server has.
    await expect(page.getByText("You are signed out.", { exact: true })).toBeVisible({ timeout: 15_000 });

    // Replay the original cookie to prove server revocation. The request context
    // survives the sign-out navigation and does not confuse a cleared cookie with revocation.
    const after = await page.request.get("/api/v1/auth/session", { headers: { cookie: originalCookies } });
    expect(after.status(), "sign out must revoke the session, not just the rendered state").toBe(401);
  });
}

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
  const presented = await openSignInLink(page, `/portal/#verify=${encodeURIComponent(joinToken!)}`);
  expect(presented.ok(), "a join capability must be refused as a sign-in").toBe(false);
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible({ timeout: 15_000 });
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/session", { credentials: "same-origin" });
    return response.status;
  });
  expect(session, "a join capability must not authenticate a portal session").toBe(401);
});
