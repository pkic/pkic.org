import { expect, test } from "@playwright/test";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { userDetailResponseSchema } from "../../assets/shared/schemas/user-management";

const USER_ID = "00000000-0000-4000-8000-000000000041";

test("a signed-in nonmember can use saved contact details without an empty identity picker", async ({ page }) => {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      json: userAuthSessionResponseSchema.parse({
        success: true,
        expiresAt: "2099-12-31T23:59:59.000Z",
        idleExpiresAt: "2099-12-31T23:59:59.000Z",
        identity: { id: USER_ID, email: "ada@example.test" },
        eventParticipation: true,
      }),
    }),
  );
  await page.route(`**/api/v1/users/${USER_ID}`, (route) =>
    route.fulfill({
      json: userDetailResponseSchema.parse({
        user: {
          id: USER_ID,
          email: "ada@example.test",
          first_name: "Ada",
          last_name: "Lovelace",
          preferred_name: null,
          role: "user",
          active: true,
          isEcMember: false,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          pii_redacted_at: null,
          headshotUrl: null,
          identities: [],
          formerIdentities: [],
        },
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

  await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
  await page.getByRole("button", { name: "Use saved profile", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "First name (required)", exact: true })).toHaveValue("Ada");
  await expect(page.getByRole("textbox", { name: "Last name (required)", exact: true })).toHaveValue("Lovelace");
  await expect(page.getByRole("textbox", { name: "Work email (required)", exact: true })).toHaveValue(
    "ada@example.test",
  );
  await expect(page.getByRole("combobox", { name: "Event identity" })).toHaveCount(0);
});

test("a signed-out visitor gets clear profile guidance and keeps entered registration details", async ({ page }) => {
  let sessionRequests = 0;
  await page.route("**/api/v1/auth/session", (route) => {
    sessionRequests += 1;
    return route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
    });
  });
  await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
  const profile = page.getByRole("button", { name: "Use saved profile", exact: true });
  await expect(profile).toBeVisible();
  expect(sessionRequests).toBe(0);
  const firstName = page.getByRole("textbox", { name: "First name (required)", exact: true });
  await firstName.fill("Entered name");
  await profile.click();
  await expect(page.getByRole("status").filter({ hasText: "You are not signed in" })).toBeVisible();
  await expect(firstName).toHaveValue("Entered name");
  expect(sessionRequests).toBe(1);
  await expect(page.getByRole("combobox", { name: "Event identity" })).toHaveCount(0);
});
