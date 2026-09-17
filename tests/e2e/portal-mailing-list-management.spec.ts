/**
 * @covers groups.8.9
 */
import { openRow, runRowAction } from "./helpers/data-table";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog, confirmDialog } from "./helpers/confirm-dialog";
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

  const management = page.getByRole("region", { name: "Managed mailing lists" });
  await expect(page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible();
  await expect(management).toBeVisible();
  await expect(management.getByRole("row").filter({ hasText: "pqc@lists.pkic.org" })).toBeVisible();
  await management.getByRole("button", { name: "Add mailing list" }).click();

  // Creating is a page of its own: the list it adds to is not underneath it.
  await expect(page).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/mailing-lists/new$`));
  await expect(management).toHaveCount(0);
  const createForm = page.locator("form").filter({ hasText: "New group mailing list" });
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
  // And it returns to the list it added to.
  await expect(page).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/mailing-lists$`));

  const row = management.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await expect(row).toContainText(label);

  // The row opens the list's own page — an address of its own, with the
  // people on the list first and the configuration on a tab beside them.
  await openRow(row, `Open ${label}`);
  await expect(page).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/mailing-lists/[^/]+$`));
  await expect(management).toHaveCount(0);
  await expect(page.getByRole("heading", { name: label, level: 3 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Group navigation" })
      .getByRole("link", { name: "Post-Quantum Cryptography Working Group", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "← All mailing lists" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: `${label} subscribers` })).toBeVisible();

  // The record's own tab strip, named after the list: the workspace around it
  // has a Settings tab of its own, and this one belongs to the list.
  const recordTabs = page.getByRole("navigation", { name: `${label} sections` });
  await recordTabs.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/mailing-lists/[^/]+/settings$`));
  let settings = page.getByRole("region", { name: `${label} settings` });
  await expect(settings.getByLabel("Label")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await settings
    .getByRole("region", { name: "Delivery", exact: true })
    .getByRole("button", { name: "Delivery actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await settings.getByLabel("Label").fill("Unsaved change");
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settings.getByLabel("Label")).toHaveCount(0);
  await expect(settings).toContainText(label);
  await settings
    .getByRole("region", { name: "Delivery", exact: true })
    .getByRole("button", { name: "Delivery actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(settings.getByLabel("Label")).toHaveValue(label);
  await settings.getByLabel("Label").fill(editedLabel);
  // The edit is asserted on its own response, the way the creation above is,
  // rather than by racing the table's re-render.
  const listUpdated = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.startsWith(`/api/v1/groups/${GROUP_ID}/mailing-lists/`),
  );
  await settings.getByRole("button", { name: "Save changes" }).click();
  expect((await listUpdated).status()).toBe(200);
  settings = page.getByRole("region", { name: `${editedLabel} settings` });
  await expect(settings.getByLabel("Label")).toHaveCount(0);
  await expect(settings).toContainText(editedLabel);
  await page.reload();
  await expect(settings).toContainText(editedLabel);
  await expect(settings.getByLabel("Label")).toHaveCount(0);

  const standing = page.getByRole("region", { name: "Standing", exact: true });
  await expect(standing).toContainText("Created");
  await expect(settings).not.toContainText("Primary discussion");
  await standing.getByRole("button", { name: "Standing actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(standing.getByRole("checkbox", { name: "Active", exact: true })).toBeChecked();
  await standing.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(standing.getByRole("checkbox")).toHaveCount(0);

  const trail = page.getByRole("navigation", { name: "Group navigation" });
  await expect(trail.locator("li")).toHaveText([
    "Groups",
    "Post-Quantum Cryptography Working Group",
    "Mailing lists",
    editedLabel,
    "Settings",
  ]);
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Settings");
  await expect(trail.getByRole("link", { name: editedLabel, exact: true })).toHaveAttribute(
    "href",
    /mailing-lists\/[^/]+$/,
  );
  await trail.getByRole("link", { name: "Mailing lists", exact: true }).click();
  await expect(management.getByRole("row").filter({ hasText: email })).toBeVisible();
  await expect(trail.locator("li")).toHaveText(["Groups", "Post-Quantum Cryptography Working Group", "Mailing lists"]);
  await page.goBack();
  await expect(settings).toBeVisible();
  await expect(trail.locator('[aria-current="page"]')).toHaveText("Settings");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: test.info().outputPath("mailing-settings-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(settings).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const collectionTab = page
    .getByRole("navigation", { name: "Post-Quantum Cryptography Working Group sections" })
    .getByRole("link", { name: "Mailing lists", exact: true });
  await expect(collectionTab).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: test.info().outputPath("mailing-settings-mobile.png"), fullPage: true });
  await collectionTab.click();
  await expect(management.getByRole("row").filter({ hasText: email })).toBeVisible();
  await page.goBack();
  await expect(settings).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole("navigation", { name: "Post-Quantum Cryptography Working Group sections" })
    .getByRole("link", { name: "Mailing lists", exact: true })
    .click();
  const editedRow = management.getByRole("row").filter({ hasText: email });
  await expect(editedRow).toContainText(editedLabel);
  // Archiving goes through the portal's own confirmation, not `window.confirm`.
  // Whether it is reached as a button or through the row's menu depends on how
  // many actions that row offers, which is the helper's problem, not this
  // test's.
  await runRowAction(page, editedRow, "Archive");
  await expect(confirmDialog(page)).toContainText(editedLabel);
  await acceptConfirmDialog(page, "Archive mailing list");
  await expect(editedRow).toContainText("Archived");
  // Archiving is reversible, so the archived row offers the way back rather
  // than the same command greyed out.
  await runRowAction(page, editedRow, "Restore");
  await acceptConfirmDialog(page, "Restore mailing list");
  await expect(editedRow).toContainText("Active");

  expect(adminRequests, "portal group management must not fall back to admin APIs").toEqual([]);
  expect(groupMailingListRequests).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/mailing-lists\/management$/),
      expect.stringMatching(/^POST \/api\/v1\/groups\/.*\/mailing-lists$/),
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/mailing-lists\/[^/]+\/subscribers/),
      expect.stringMatching(/^PATCH \/api\/v1\/groups\/.*\/mailing-lists\/.+$/),
      expect.stringMatching(/^POST \/api\/v1\/groups\/.*\/mailing-lists\/.+\/transitions$/),
    ]),
  );
});
