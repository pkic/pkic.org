import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const EMAIL_TEMPLATES_API = "/api/v1/email/templates";
const REMOVED_ADMIN_TEMPLATES_API = "/api/v1/admin/email-templates";

test("permitted staff create, preview, activate, and reopen an email template through the portal", async ({ page }) => {
  const emailTemplateRequests: string[] = [];
  const removedAdminRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === EMAIL_TEMPLATES_API || pathname.startsWith(`${EMAIL_TEMPLATES_API}/`)) {
      emailTemplateRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === REMOVED_ADMIN_TEMPLATES_API || pathname.startsWith(`${REMOVED_ADMIN_TEMPLATES_API}/`)) {
      removedAdminRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-email-templates"));
  await page.goto("/portal/#/system/email-templates");

  await expect(page.getByRole("link", { name: "Email Templates" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Template", exact: false })).toBeVisible();

  const templateKey = `e2e_system_template_${Date.now()}`;
  const initialBody = "Hello {{firstName}}, this is the initial system template.";
  await page.getByRole("button", { name: "New Template", exact: false }).click();
  await page.getByLabel("Template key").fill(templateKey);
  await expect(page.getByText("Key is available", { exact: true })).toBeVisible();
  await page.getByLabel("Subject template").fill("System template for {{firstName}}");
  await page.getByLabel("Body", { exact: true }).fill(initialBody);

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${EMAIL_TEMPLATES_API}/${templateKey}/versions` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create Template" }).click();
  expect((await createResponse).status()).toBe(200);
  await expect(page.getByText(`Edit: ${templateKey}`, { exact: false })).toBeVisible();

  const revisedBody = "Hello {{firstName}}, this version is ready for immediate activation.";
  await page.locator("#email-template-editor-body").fill(revisedBody);
  const previewResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${EMAIL_TEMPLATES_API}/preview` && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Render Preview" }).click();
  expect((await previewResponse).status()).toBe(200);
  await expect(page.getByText("Preview rendered.", { exact: true })).toBeVisible();
  await expect(page.locator("iframe[title='Rendered email HTML preview']")).toHaveAttribute("sandbox", "");
  await expect(page.frameLocator("iframe[title='Rendered email HTML preview']").locator("body")).toContainText(
    "ready for immediate activation",
  );

  const saveResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${EMAIL_TEMPLATES_API}/${templateKey}/versions` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save as Draft" }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByText("Saved as draft v2", { exact: true })).toBeVisible();

  const versionTwoRow = page.getByRole("row").filter({ has: page.getByText("v2", { exact: true }) });
  const activateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${EMAIL_TEMPLATES_API}/${templateKey}/activate` &&
      response.request().method() === "POST",
  );
  await versionTwoRow.getByRole("button", { name: "Activate" }).click();
  expect((await activateResponse).status()).toBe(200);
  await expect(page.getByText("v2 is now active", { exact: true })).toBeVisible();
  await expect(versionTwoRow.getByText("In use", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByPlaceholder("Search template key…").fill(templateKey);
  await expect(page.getByRole("cell", { name: templateKey })).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: templateKey })
    .getByRole("button", { name: "Edit", exact: false })
    .click();
  await expect(page.locator("#email-template-editor-body")).toHaveValue(revisedBody);
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByText("v2", { exact: true }) })
      .getByText("In use"),
  ).toBeVisible();

  await page.goto("/admin/#/email/templates");
  await expect(page).toHaveURL(/\/portal\/#\/system\/email-templates$/);
  await expect(page.getByRole("link", { name: "Email Templates" })).toBeVisible();

  expect(emailTemplateRequests).toEqual(
    expect.arrayContaining([
      `GET ${EMAIL_TEMPLATES_API}`,
      `POST ${EMAIL_TEMPLATES_API}/${templateKey}/versions`,
      `POST ${EMAIL_TEMPLATES_API}/preview`,
      `POST ${EMAIL_TEMPLATES_API}/${templateKey}/activate`,
    ]),
  );
  expect(removedAdminRequests).toEqual([]);
});
