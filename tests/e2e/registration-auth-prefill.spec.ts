import { expect, test } from "@playwright/test";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { registrationEmailProofStartSchema } from "../../assets/shared/schemas/registration-email-proof";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";

const USER_ID = "00000000-0000-4000-8000-000000000041";
const REGISTRATION_PAGE = "/events/2026/pqc-conference-amsterdam-nl/register/";
const copy = EMAIL_FIRST_COPY.registration;

test("a signed-in nonmember continues with saved details and no empty identity picker", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: userAuthSessionResponseSchema.parse({
        success: true,
        sessionId: "00000000-0000-4000-8000-000000000042",
        expiresAt: "2099-12-31T23:59:59.000Z",
        idleExpiresAt: "2099-12-31T23:59:59.000Z",
        identity: { id: USER_ID, email: "ada@example.test" },
        eventParticipation: true,
      }),
    }),
  );
  await page.route("**/api/v1/users/current", (route) =>
    route.fulfill({
      json: myProfileSchema.parse({
        ...portalProfileFixture(portalSessionFixture({})),
        userId: USER_ID,
        email: "ada@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
      }),
    }),
  );
  await page.route("**/api/v1/users/current/identities?*", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: identitiesListResponseSchema.parse({
        identities: [],
        page: { limit: Number(url.searchParams.get("limit")), offset: 0, total: 0, hasMore: false },
      }),
    });
  });

  await page.goto(REGISTRATION_PAGE);
  const contact = page.locator("[data-registration-contact]");
  await contact.getByLabel(copy.work.label).fill("ada@example.test");
  await contact.getByRole("button", { name: copy.work.action, exact: true }).click();
  await expect(contact).toContainText("Ada Lovelace");
  await expect(contact.getByRole("textbox", { name: /First name/ })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Representation" })).toHaveCount(0);
});

test("a signed-out visitor verifies the address first and is asked nothing else until the link is opened", async ({
  page,
}) => {
  let sessionRequests = 0;
  let proofRequest: unknown;
  await page.route("**/api/v1/auth/session", (route) => {
    sessionRequests += 1;
    return route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
    });
  });
  await page.route("**/registrations/proof", (route) => {
    proofRequest = route.request().postDataJSON();
    return route.fulfill({ json: { status: "verification_sent" } });
  });
  await page.goto(REGISTRATION_PAGE);
  const contact = page.locator("[data-registration-contact]");
  await expect(contact.getByLabel(copy.work.label)).toBeVisible();
  // The public account menu checks the session once; the contact step waits for Continue.
  await expect.poll(() => sessionRequests).toBe(1);
  await contact.getByLabel(copy.work.label).fill("new-attendee@example.test");
  await contact.getByRole("button", { name: copy.work.action, exact: true }).click();
  await expect(contact.getByText(copy.sentTitle, { exact: true })).toBeVisible();
  await expect(contact.getByText(copy.sent("new-attendee@example.test"), { exact: true })).toBeVisible();
  expect(sessionRequests).toBe(2);
  expect(registrationEmailProofStartSchema.parse(proofRequest)).toMatchObject({
    email: "new-attendee@example.test",
    unaffiliatedAttestation: false,
  });
  await expect(contact.getByRole("textbox", { name: /First name/ })).toHaveCount(0);
  await expect(page.locator("[data-event-registration] [data-step-next]")).toBeHidden();
  await contact.getByRole("button", { name: copy.changeEmail, exact: true }).click();
  await expect(contact.getByLabel(copy.work.label)).toBeVisible();
});
