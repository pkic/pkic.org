import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import {
  organizationDetailResponseSchema,
  organizationManagementUpdateSchema,
} from "../../assets/shared/schemas/organization-management";

test("staff compose visual blocks, cancel drafts, and publish the same Markdown to the member page", async ({
  page,
}, testInfo) => {
  await signInToPortal(page, e2eAdminEmail("portal-organizations"));
  const created = await page.evaluate(async (name) => {
    const response = await fetch("/api/v1/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        membershipCategory: "F",
        memberSince: "2026-01-15",
        identities: [],
        workingGroupSlugs: [],
        activationReason: "Editor workflow fixture",
      }),
    });
    return { status: response.status, body: await response.json() };
  }, `Visual content ${Date.now()}`);
  expect(created.status).toBe(201);
  const detail = organizationDetailResponseSchema.parse(created.body).organization;
  await page.goto(`/portal/#/organizations/${detail.id}`);
  const edit = async () => {
    await page.getByRole("button", { name: "Record actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit organization…" }).click();
  };
  await expect(page.getByRole("textbox", { name: "Member page content", exact: true })).toHaveCount(0);
  await edit();
  const canvas = page.getByRole("textbox", { name: "Member page content", exact: true });
  // Two editors share the page since the description became one too (#114);
  // the bar's commands are scoped to the content editor's own bar.
  // Anchored on the editor's own hidden field rather than on the canvas,
  // which is hidden — and so unmatchable — while the source view is open.
  const contentEditor = page.locator(".pk-markdown-editor").filter({ has: page.locator('[name="contentMarkdown"]') });
  await canvas.fill("A draft to cancel.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await edit();
  await expect(canvas).not.toContainText("A draft to cancel.");
  await canvas.fill("Security begins with clear information.");
  await canvas.press("ControlOrMeta+a");
  await contentEditor.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(canvas.locator("strong")).toHaveText("Security begins with clear information.");
  await canvas.press("ControlOrMeta+End");
  await canvas.press("Enter");
  await page.getByRole("group", { name: "Content blocks" }).getByRole("button", { name: "Video", exact: true }).click();
  await page.getByLabel("Video URL").fill("https://example.test/not-a-video");
  await page.getByRole("button", { name: "Insert video", exact: true }).click();
  await expect(page.getByLabel("Video URL")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Video URL").fill("https://www.youtube.com/watch?v=HGoZW7MCF60");
  await page.getByRole("button", { name: "Insert video", exact: true }).click();
  await expect(canvas.locator("iframe")).toHaveCount(1);
  await canvas.press("ControlOrMeta+End");
  await page
    .getByRole("group", { name: "Content blocks" })
    .getByRole("button", { name: "Table", exact: true })
    .dragTo(canvas, { targetPosition: { x: 20, y: 30 } });
  await expect(canvas.locator("table")).toHaveCount(1);
  await canvas.locator("th").first().click();
  await page.keyboard.type("Capability");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Availability");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Certificate automation");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Available");
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(canvas.locator("th")).toHaveCount(3);
  await canvas.locator("th").nth(2).click();
  await page.getByRole("button", { name: "Delete column", exact: true }).click();
  await expect(canvas.locator("th")).toHaveCount(2);
  await canvas.press("ControlOrMeta+End");
  await canvas.press("Enter");
  await page.getByRole("group", { name: "Content blocks" }).getByRole("button", { name: "Image", exact: true }).click();
  await page.getByLabel("Image URL").fill("/img/logo-color.svg");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  await expect(page.getByLabel("Image description")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Image description").fill("PKI Consortium logo");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  await expect(canvas.getByRole("img", { name: "PKI Consortium logo" })).toBeVisible();
  await canvas.press("ControlOrMeta+End");
  await page
    .getByRole("group", { name: "Content blocks" })
    .getByRole("button", { name: "Callout", exact: true })
    .click();
  await canvas.locator("blockquote p").click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe("Write your callout here.");
  await page.keyboard.type("Built for interoperability.");
  await expect(canvas.locator("blockquote")).toHaveText("Built for interoperability.");
  await canvas.press("ControlOrMeta+End");
  await page
    .getByRole("group", { name: "Content blocks" })
    .getByRole("button", { name: "Section", exact: true })
    .click();
  await canvas.getByRole("heading", { name: "Section heading" }).click({ clickCount: 3 });
  await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe("Section heading");
  await page.keyboard.type("Learn more");
  await contentEditor.getByRole("button", { name: "Markdown source", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Member page content Markdown source", exact: true })).toHaveValue(
    /Built for interoperability\./,
  );
  await contentEditor.getByRole("button", { name: "Visual editor", exact: true }).click();
  await expect(canvas.locator("[style]")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await canvas.scrollIntoViewIfNeeded();
  await contentEditor.screenshot({ path: testInfo.outputPath("visual-editor-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await canvas.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await contentEditor.screenshot({ path: testInfo.outputPath("visual-editor-phone.png") });
  await page.setViewportSize({ width: 1440, height: 1100 });
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `/api/v1/organizations/${detail.id}`,
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const patch = organizationManagementUpdateSchema.parse(response.request().postDataJSON());
  expect(patch.contentMarkdown).toContain("**Security begins with clear information.**");
  expect(patch.contentMarkdown).toContain("| Capability");
  expect(patch.contentMarkdown).not.toContain("<iframe");
  await page.reload();
  await edit();
  await expect(canvas.locator("table")).toContainText("Certificate automation");
  await expect(canvas.locator("iframe")).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto(detail.publicProfileHref!);
  await expect(page.locator("strong").filter({ hasText: "Security begins with clear information." })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Certificate automation", exact: true })).toBeVisible();
  await expect(page.locator('iframe[title="Embedded video"]')).toHaveAttribute(
    "src",
    "https://www.youtube.com/embed/HGoZW7MCF60",
  );
  await expect(page.getByRole("img", { name: "PKI Consortium logo", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learn more", exact: true })).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("Built for interoperability.");
  await page.screenshot({ path: testInfo.outputPath("member-page-rendered.png"), fullPage: true });
});
