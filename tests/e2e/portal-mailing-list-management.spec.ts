import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

test("a portal group manager creates, edits, and archives a mailing list", async ({ page }) => {
  const adminRequests: string[] = [];
  const groupMailingListRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/admin/")) adminRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith(`/api/v1/groups/${GROUP_ID}/mailing-lists`)) {
      groupMailingListRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-mailing-lists"));
  await page.goto(`/portal/#/groups/${GROUP_ID}/mailing-lists`);

  const management = page.getByRole("region", { name: "Mailing-list management" });
  await expect(page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible();
  await expect(management).toBeVisible();
  await expect(management.getByRole("row").filter({ hasText: "pqc@lists.pkic.org" })).toBeVisible();
  await management.getByRole("button", { name: "Add mailing list" }).click();

  const createForm = management.locator("form").filter({ hasText: "New group mailing list" });
  const stamp = `${Date.now()}-${test.info().workerIndex}`;
  const email = `e2e-list-${stamp}@lists.pkic.org`;
  const label = `E2E group list ${stamp}`;
  const editedLabel = `${label} (edited)`;
  await createForm.getByLabel("Email").fill(email);
  await createForm.getByLabel("Label").fill(label);
  await createForm.getByLabel("Purpose").selectOption("group");
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/groups/${GROUP_ID}/mailing-lists`,
  );
  await createForm.getByRole("button", { name: "Create mailing list" }).click();
  expect((await createResponse).status()).toBe(201);

  const row = management.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await expect(row).toContainText(label);

  await row.getByRole("button", { name: "Manage" }).click();
  const editRow = management.locator("tr").filter({ hasText: `Manage ${label}` });
  await expect(editRow).toBeVisible();
  await editRow.getByLabel("Label").fill(editedLabel);
  await editRow.getByRole("button", { name: "Save changes" }).click();

  const editedRow = management.getByRole("row").filter({ hasText: email });
  await expect(editedRow).toContainText(editedLabel);
  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toContain(editedLabel);
    await dialog.accept();
  });
  await editedRow.getByRole("button", { name: "Archive" }).click();
  await expect(editedRow).toContainText("Archived");
  await expect(editedRow.getByRole("button", { name: "Archive" })).toBeDisabled();

  expect(adminRequests, "portal group management must not fall back to admin APIs").toEqual([]);
  expect(groupMailingListRequests).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/mailing-lists\/management$/),
      expect.stringMatching(/^POST \/api\/v1\/groups\/.*\/mailing-lists$/),
      expect.stringMatching(/^PATCH \/api\/v1\/groups\/.*\/mailing-lists\/.+$/),
      expect.stringMatching(/^DELETE \/api\/v1\/groups\/.*\/mailing-lists\/.+$/),
    ]),
  );
});
