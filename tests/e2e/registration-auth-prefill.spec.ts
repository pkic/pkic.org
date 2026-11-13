import { expect, test } from "@playwright/test";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";

const USER_ID = "00000000-0000-4000-8000-000000000041";
const REGISTRATION_PAGE = "/events/2026/pqc-conference-amsterdam-nl/register/";

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
  await expect(contact).toContainText("Ada Lovelace");
  await expect(contact.getByRole("textbox", { name: /First name/ })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Representation" })).toHaveCount(0);
});

test("a signed-out visitor gets the sign-in card in place of the registration form", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
    }),
  );
  await page.goto(REGISTRATION_PAGE);
  const card = page.locator("[data-registration-sign-in]").getByRole("region", { name: "Sign in", exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "New here?", exact: true })).toBeVisible();
  // Nothing is asked, and the wizard cannot continue, until the person is signed in.
  await expect(page.locator("[data-registration-contact]")).toBeHidden();
  await expect(page.locator("[data-event-registration] [data-step-next]")).toBeHidden();
});
