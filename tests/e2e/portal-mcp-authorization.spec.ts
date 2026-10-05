import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { clientIpForIdentity } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test("MCP discovery and consent recover from an expired cookie through email sign-in", async ({
  page,
  request,
  baseURL,
}) => {
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
  await expect(page.getByRole("heading", { name: "Authorize MCP access" })).toBeVisible();
  await page.getByLabel("Portal email").fill(email);
  const since = await capturedEmailCount();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("you'll receive a sign-in link shortly", { exact: false })).toBeVisible();
  const message = await waitForCapturedEmail(email, "sign-in link", { since });
  await page.goto(extractEmailUrl(message, "/portal/"));
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/mcp-consent.png", fullPage: true });
  await page.route("**/oauth-test-callback?**", (route) =>
    route.fulfill({ body: "Authorization returned to client." }),
  );
  await page.getByRole("button", { name: "Approve", exact: true }).click();
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
});
