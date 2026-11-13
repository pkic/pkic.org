import { expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { EMAIL_FIRST_COPY, type EmailFirstFlow } from "../../../assets/shared/email-first-copy";
import { userSignUpRequestSchema } from "../../../assets/shared/schemas/user-auth";
import { clientIpForIdentity } from "./portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";

const SIGN_IN_LINK_SUBJECT = "sign-in link";

function requestTo(page: Page, path: string) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === "POST",
    { timeout: 60_000 },
  );
}

/**
 * Signs a person in through the shared sign-in card a public page shows a
 * signed-out visitor (registration, the proposal form, joining), and comes
 * back to that page signed in.
 *
 * By default the person starts with their email under "New here?": a new
 * address gets its account when the emailed link is opened, and an address
 * that already signs in receives a sign-in link from the same step. Pass
 * `returning` to use "Sign in with an email link" instead.
 */
export async function signInThroughCard(
  page: Page,
  email: string,
  options: { individual?: boolean; emailFlow?: EmailFirstFlow; returning?: boolean } = {},
): Promise<void> {
  // Independent people arrive from independent clients; see `signInToPortal`.
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });
  const returnTo = new URL(page.url());
  // The invitation token stays in the browser, never in the emailed link; the id finds it again.
  returnTo.searchParams.delete("invite");
  const card = page.getByRole("region", { name: "Sign in", exact: true });
  await expect(card.getByRole("button", { name: "Sign in with a passkey" })).toBeEnabled({ timeout: 30_000 });
  const since = await capturedEmailCount();
  if (options.returning) {
    await card.getByRole("button", { name: "Sign in with an email link", exact: true }).click();
    await card.getByRole("textbox", { name: /^Email/ }).fill(email);
    const requested = requestTo(page, "/api/v1/auth/request-link");
    await card.getByRole("button", { name: "Send sign-in link" }).click();
    const response = await requested;
    expect(response.status(), await response.text()).toBe(200);
    await expect(card.getByText("you'll receive a sign-in link shortly", { exact: false })).toBeVisible();
  } else {
    const copy = EMAIL_FIRST_COPY[options.emailFlow ?? "registration"];
    const choice = options.individual ? copy.personal : copy.work;
    await card.getByRole("button", { name: "Continue with your email", exact: true }).click();
    if (options.individual) await card.getByRole("radio", { name: copy.personal.title, exact: true }).check();
    await card.getByLabel(choice.label, { exact: true }).fill(email);
    const requested = requestTo(page, "/api/v1/auth/sign-up");
    await card.getByRole("button", { name: choice.action, exact: true }).click();
    const response = await requested;
    expect(response.status(), await response.text()).toBe(200);
    expect(userSignUpRequestSchema.parse(response.request().postDataJSON())).toMatchObject({
      email,
      unaffiliatedAttestation: Boolean(options.individual),
      returnPath: `${returnTo.pathname}${returnTo.search}`,
    });
    await expect(card.getByText(copy.sent(email), { exact: true })).toBeVisible();
  }
  const message = await waitForCapturedEmail(email, SIGN_IN_LINK_SUBJECT, { since });
  // The link opens as a fresh document, the way a mail client opens it.
  await page.goto("about:blank");
  const verified = requestTo(page, "/api/v1/auth/verify-link");
  await page.goto(extractEmailUrl(message, "/portal/#/verify"));
  // The page leaves for the form as soon as the session exists, so only the status is read.
  expect((await verified).status(), "the emailed link must sign the person in").toBe(200);
  // The portal may offer a passkey before it returns the person to the page they came from.
  const passkeyOffer = page.getByRole("region", { name: "You're signed in", exact: true });
  const returned = () => {
    const current = new URL(page.url());
    return current.pathname === returnTo.pathname && current.search === returnTo.search;
  };
  await expect
    .poll(
      async () => {
        if (returned()) return true;
        if (await passkeyOffer.isVisible().catch(() => false))
          await passkeyOffer
            .getByRole("button", { name: "Continue without a passkey", exact: true })
            .click()
            .catch(() => undefined);
        return returned();
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.waitForLoadState("domcontentloaded");
}

/**
 * The same sign-in without a browser: a request context that holds the
 * session of the person behind `email`, started the way the card starts it.
 * For fixtures that submit to the API as that person. The caller disposes it.
 */
export async function signedInRequest(
  origin: string,
  email: string,
  options: { individual?: boolean } = {},
): Promise<APIRequestContext> {
  const context = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { "cf-connecting-ip": clientIpForIdentity(email) },
  });
  try {
    const since = await capturedEmailCount();
    const start = () =>
      context.post("/api/v1/auth/sign-up", {
        data: userSignUpRequestSchema.parse({ email, unaffiliatedAttestation: options.individual ?? false }),
      });
    let started = await start();
    // The local D1 binding occasionally drops its connection under load; the refused start sent no mail, so asking once more is safe.
    if (started.status() === 500 && (await started.text()).includes("Network connection lost")) started = await start();
    expect(started.status(), await started.text()).toBe(200);
    const message = await waitForCapturedEmail(email, SIGN_IN_LINK_SUBJECT, { since });
    const link = new URL(extractEmailUrl(message, "/portal/#/verify"));
    const token = new URLSearchParams(link.hash.slice(link.hash.indexOf("?") + 1)).get("token");
    expect(token, "the emailed link must carry a sign-in token").toBeTruthy();
    const signedIn = await context.post("/api/v1/auth/verify-link", { data: { token } });
    expect(signedIn.status(), await signedIn.text()).toBe(200);
    return context;
  } catch (error) {
    await context.dispose();
    throw error;
  }
}
