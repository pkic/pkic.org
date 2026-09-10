/**
 * @covers system.12.6
 */
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
  await page.goto("/portal/#/settings/email-templates");

  await expect(page.getByRole("link", { name: "Email templates" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Template", exact: false })).toBeVisible();

  const templateKey = `e2e_system_template_${Date.now()}`;
  const initialBody = "Hello {{firstName}}, this is the initial system template.";
  await page.getByRole("button", { name: "New Template", exact: false }).click();
  await page.getByLabel("Template key").fill(templateKey);
  await expect(page.getByText("Key is available", { exact: true })).toBeVisible();
  await page.getByLabel("Subject template").fill("System template for {{firstName}}");
  // A required Field carries a screen-reader-only "(required)" inside its
  // label, so that — not the bare word — is the control's accessible name.
  await page.getByRole("textbox", { name: "Body (required)", exact: true }).fill(initialBody);

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${EMAIL_TEMPLATES_API}/${templateKey}/versions` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create Template" }).click();
  expect((await createResponse).status()).toBe(200);
  await expect(page.getByText(`Edit: ${templateKey}`, { exact: false })).toBeVisible();

  const revisedBody = "Hello {{firstName}}, this version is ready for immediate activation.";
  await page.getByLabel("Body").fill(revisedBody);
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

  // The editor and rendered result share the working width on a wide screen.
  await page.setViewportSize({ width: 1920, height: 1080 });
  const split = page.locator(".pk-split");
  const columns = await split.locator(":scope > *").evaluateAll((elements) =>
    elements.map((element) => ({
      width: element.getBoundingClientRect().width,
      top: element.getBoundingClientRect().top,
    })),
  );
  expect(columns).toHaveLength(2);
  expect(Math.abs(columns[0].width - columns[1].width)).toBeLessThanOrEqual(1);
  expect(Math.abs(columns[0].top - columns[1].top)).toBeLessThanOrEqual(1);
  await page.getByRole("heading", { name: `Edit: ${templateKey}`, exact: true }).scrollIntoViewIfNeeded();
  await expect(page.frameLocator("iframe[title='Rendered email HTML preview']").locator("body")).toContainText(
    "ready for immediate activation",
  );
  await page.screenshot({ path: test.info().outputPath("email-editor-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
    0,
  );
  const mobileColumns = await split.locator(":scope > *").evaluateAll((elements) =>
    elements.map((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
    })),
  );
  expect(mobileColumns[1].top).toBeGreaterThanOrEqual(mobileColumns[0].bottom);
  await page.screenshot({ path: test.info().outputPath("email-editor-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

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
  await expect(page.getByLabel("Body")).toHaveValue(revisedBody);
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByText("v2", { exact: true }) })
      .getByText("In use"),
  ).toBeVisible();

  await page.goto("/portal/#/settings/email-templates");
  await expect(page).toHaveURL(/\/portal\/#\/settings\/email-templates$/);
  await expect(page.getByRole("link", { name: "Email templates" })).toBeVisible();

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
