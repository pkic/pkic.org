import { attachVirtualAuthenticator, openOwnUserRecord, openAddPasskey, enrollPasskey } from "./helpers/passkeys";
import { oauthAuthorizationResponseSchema } from "../../assets/shared/schemas/oauth-authorizations";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { clientIpForIdentity } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test("MCP consent uses portal sign-in and requires a passkey for longer access", async ({ page, request, baseURL }) => {
  const email = e2eAdminEmail("default");
  const resource = `${baseURL}/api/v1/mcp`;
  const metadata = await request.get("/.well-known/oauth-protected-resource/api/v1/mcp");
  expect(metadata.ok()).toBe(true);
  expect(await metadata.json()).toMatchObject({ resource, authorization_servers: [baseURL] });
  const registration = await request.post("/api/v1/auth/oauth/register", {
    data: {
      client_name: "Example forms, organizations, and users client",
      redirect_uris: [`${baseURL}/oauth-test-callback`],
      token_endpoint_auth_method: "none",
    },
  });
  expect(registration.status()).toBe(201);
  const { client_id: clientId } = await registration.json();
  const verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseURL}/oauth-test-callback`,
    response_type: "code",
    scope: "forms:read organizations:read users:read",
    state: "browser-test",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
  });
  await page
    .context()
    .addCookies([
      { name: "pkic_session", value: "expired-session", domain: new URL(baseURL!).hostname, path: "/api/v1" },
    ]);
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });
  await page.goto(`/api/v1/auth/oauth/authorize?${params}`);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  const consentLocation = page.url();
  const reference = new URLSearchParams(new URL(consentLocation).hash.split("?", 2)[1]).get("request");
  expect(reference).toMatch(/^[0-9a-f-]{36}$/);
  expect(consentLocation).not.toContain("return_to=");
  await expect(page.getByRole("button", { name: "Sign in with a passkey", exact: true })).toBeEnabled();
  await page.screenshot({ path: "test-results/mcp-login-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "test-results/mcp-login-phone.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Sign in with an email link", exact: true }).click();
  await page.getByLabel("Work email", { exact: false }).fill(email);
  const since = await capturedEmailCount();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByRole("alert").or(page.getByRole("status")).filter({ hasText: "Check your email" }),
  ).toBeVisible();
  const message = await waitForCapturedEmail(email, "sign-in link", { since });
  let consentUnavailable = true;
  await page.route("**/api/v1/auth/oauth/authorize?request=*", async (route) => {
    if (consentUnavailable) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Temporary consent failure." } }),
      });
    } else {
      await route.continue();
    }
  });
  const link = extractEmailUrl(message, "/portal/");
  expect(new URL(link).hash).toContain("#/verify?");
  await page.goto(link);
  await expect(page.getByRole("alert")).toContainText("Temporary consent failure.");
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
  expect(new URLSearchParams(new URL(page.url()).hash.split("?", 2)[1]).has("token")).toBe(false);
  await page.screenshot({ path: "test-results/mcp-consent-retry.png", fullPage: true });
  consentUnavailable = false;
  await page.reload();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/mcp-consent.png", fullPage: true });
  await page.route("**/oauth-test-callback?**", (route) =>
    route.fulfill({ body: "Authorization returned to client." }),
  );
  const accepted = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/auth/oauth/authorize") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Authorize", exact: true }).click();
  const { authorizationId: shortAuthorizationId } = await (await accepted).json();
  await expect(page).toHaveURL(/oauth-test-callback\?.*code=/);
  const code = new URL(page.url()).searchParams.get("code")!;
  const tokens = await request.post("/api/v1/auth/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: `${baseURL}/oauth-test-callback`,
      code,
      code_verifier: verifier,
      resource,
    },
  });
  expect(tokens.ok()).toBe(true);
  const credentials = await tokens.json();
  const initialize = await request.post("/api/v1/mcp", {
    headers: { authorization: `Bearer ${credentials.access_token}`, accept: "application/json, text/event-stream" },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pkic-e2e", version: "1" },
      },
    },
  });
  expect(initialize.ok()).toBe(true);
  const refreshed = await request.post("/api/v1/auth/oauth/token", {
    form: { grant_type: "refresh_token", client_id: clientId, refresh_token: credentials.refresh_token, resource },
  });
  expect(refreshed.ok()).toBe(true);

  const shortSummary = await page.request.get(`/api/v1/auth/oauth/authorizations/${shortAuthorizationId}`);
  expect(shortSummary.ok()).toBe(true);
  const short = oauthAuthorizationResponseSchema.parse(await shortSummary.json());
  expect(Date.parse(short.authorization.expiresAt) - Date.now()).toBeLessThanOrEqual(3600000);

  // Enrollment alone never changes the email-authenticated grant. Assert the credential to establish a new session.
  await attachVirtualAuthenticator(page, "internal");
  await openOwnUserRecord(page);
  await openAddPasskey(page);
  const registered = page.waitForResponse((response) => response.url().endsWith("/passkeys/register/complete"));
  await enrollPasskey(page, "MCP lifetime verification");
  const { id: credentialId } = await (await registered).json();
  await page.context().clearCookies();
  await page.goto(`/api/v1/auth/oauth/authorize?${params}`);
  await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeEnabled();
  const passkeyAccepted = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/auth/oauth/authorize") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Authorize", exact: true }).click();
  const { authorizationId: longAuthorizationId } = await (await passkeyAccepted).json();
  await expect(page).toHaveURL(/oauth-test-callback\?.*code=/);
  const passkeyCode = new URL(page.url()).searchParams.get("code")!;
  const longSummary = await page.request.get(`/api/v1/auth/oauth/authorizations/${longAuthorizationId}`);
  expect(longSummary.ok()).toBe(true);
  const long = oauthAuthorizationResponseSchema.parse(await longSummary.json());
  expect(Date.parse(long.authorization.expiresAt) - Date.now()).toBeGreaterThan(7 * 3600000);
  const passkeyTokens = await request.post("/api/v1/auth/oauth/token", {
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: `${baseURL}/oauth-test-callback`,
      code: passkeyCode,
      code_verifier: verifier,
      resource,
    },
  });
  expect(passkeyTokens.ok()).toBe(true);
  const passkeyCredentials = await passkeyTokens.json();
  expect((await page.request.delete(`/api/v1/auth/passkeys/${credentialId}`)).ok()).toBe(true);
  const revoked = await request.post("/api/v1/auth/oauth/token", {
    form: {
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: passkeyCredentials.refresh_token,
      resource,
    },
  });
  expect(revoked.status()).toBe(400);
  expect(await revoked.json()).toMatchObject({ error: "invalid_grant" });
});
