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
  await page.getByRole("textbox", { name: "Body Markdown source", exact: true }).fill(initialBody);

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${EMAIL_TEMPLATES_API}/${templateKey}/versions` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create Template" }).click();
  expect((await createResponse).status()).toBe(200);
  await expect(page.getByText(`Edit: ${templateKey}`, { exact: false })).toBeVisible();

  const source = page.getByRole("textbox", { name: "Body Markdown source", exact: true });
  const editor = page.locator(".pk-markdown-editor").filter({ has: source });
  await source.fill("{{#if firstName}}Hello {{firstName}}{{else}}Hello user{{/if}}");
  await expect(editor.locator(".pk-overlay-editor .adm-template-token-var")).toHaveText("{{firstName}}");
  await expect(
    editor.locator(".pk-overlay-editor .adm-template-token").filter({ hasText: /\{\{(?:#if|else|\/if)/ }),
  ).toHaveCount(3);
  await source.press("ControlOrMeta+End");
  await editor.getByRole("button", { name: "Insert variables and conditions" }).click();
  await page.getByRole("menuitem", { name: "organizationName", exact: true }).click();
  await expect(source).toHaveValue("{{#if firstName}}Hello {{firstName}}{{else}}Hello user{{/if}}{{organizationName}}");
  await expect(source).toBeFocused();
  await editor.getByRole("button", { name: "Visual editor", exact: true }).click();
  const visual = page.getByRole("textbox", { name: "Body", exact: true });
  await expect(visual.locator(".adm-template-token-var")).toHaveCount(2);
  await page.getByRole("button", { name: "Insert reusable templates", exact: true }).click();
  await expect(page.getByRole("menuitem").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Markdown source", exact: true }).click();

  const revisedBody = "Hello {{firstName}}, this version is ready for immediate activation.";
  await page.getByRole("textbox", { name: "Body Markdown source", exact: true }).fill(revisedBody);
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
  // Activation is a command in the row's menu, not a button on the row (#98).
  await versionTwoRow.getByRole("button", { name: "Actions for v2" }).click();
  await page.getByRole("menuitem", { name: "Activate" }).click();
  expect((await activateResponse).status()).toBe(200);
  await expect(page.getByText("v2 is now active", { exact: true })).toBeVisible();
  await expect(versionTwoRow.getByText("Active", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByPlaceholder("Search template key…").fill(templateKey);
  // The row's actions cell is also named after the key, so the row is the target.
  await expect(page.getByRole("row").filter({ hasText: templateKey })).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: templateKey })
    .getByRole("button", { name: "Edit", exact: false })
    .click();
  await expect(page.getByRole("textbox", { name: "Body Markdown source", exact: true })).toHaveValue(revisedBody);
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByText("v2", { exact: true }) })
      .getByText("Active", { exact: true }),
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
