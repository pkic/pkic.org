import { expect, test } from "@playwright/test";
import { userCreateResponseSchema, userCreateSchema } from "../../assets/shared/schemas/user-create";
import { userUpdateResponseSchema } from "../../assets/shared/schemas/user-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("staff correct a user's sign-in email through the account editor", async ({ page }, info) => {
  const suffix = crypto.randomUUID();
  const email = `email-before-${suffix}@example.test`;
  const correctedEmail = `email-after-${suffix}@example.test`;
  await signInToPortal(page, e2eAdminEmail("portal-user-headshot"));
  const created = await page.request.post("/api/v1/users", {
    data: userCreateSchema.parse({ email, firstName: "Email", lastName: "Correction" }),
  });
  expect(created.status()).toBe(201);
  const { userId } = userCreateResponseSchema.parse(await created.json());

  await page.goto("/portal/#/users");
  const search = page.getByPlaceholder("email or name");
  await search.fill(email);
  await search.press("Enter");
  await page.getByRole("row").filter({ hasText: "Email Correction" }).click();
  await page.getByRole("button", { name: "Account actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit account…", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit account", exact: true });
  await editor.getByRole("textbox", { name: "Email", exact: true }).fill(correctedEmail);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/v1/users/${userId}`,
  );
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect(userUpdateResponseSchema.parse(await response.json()).user.email).toBe(correctedEmail);
  await expect(editor).not.toBeVisible();
  await page.reload();
  await expect(page.getByText(correctedEmail, { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Account actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit account…", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(correctedEmail);
  await page.screenshot({ path: info.outputPath("corrected-user-email.png"), fullPage: true });
});
