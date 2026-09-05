import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

/**
 * A contact record reads differently depending on whose it is.
 *
 * The same page, the same permissions, two subjects: the reader's own record
 * and somebody else's. What separates them is not what the reader is allowed
 * to do — a staff account may edit both — but what the actions would mean.
 * Nobody messages themselves, follows themselves, or vouches for their own
 * skills; the last of those is a rule the write path enforces, so offering the
 * control anyway would only ever produce a refusal.
 *
 * Both halves run in one test on purpose. Asserting "Message is absent" is
 * worth nothing unless the same run shows it present somewhere — otherwise a
 * button removed by accident passes as correct.
 */

/**
 * Opens a record from the Users list, which is how a reader reaches one.
 *
 * The heading is the person's name, and falls back to their address only when
 * they have none — which is why the caller states it rather than the helper
 * assuming the two are the same string.
 */
async function openUserRecord(page: Page, email: string, heading: string): Promise<void> {
  await page.goto("/portal/#/users");
  const search = page.getByPlaceholder("email or name");
  await search.fill(email);
  await search.press("Enter");
  const row = page.locator("tr").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
}

test("a contact record offers different things on your own page than on someone else's", async ({ page }) => {
  const viewerEmail = e2eAdminEmail("portal-user-record-self");
  await signInToPortal(page, viewerEmail);

  // ── Somebody else's record ────────────────────────────────────────────────
  // The seeded demo member, who has skills to vouch for and an availability
  // panel; the reader shares no identity with them.
  const otherEmail = "paul.vanbrouwershaven@pkic.org";
  await openUserRecord(page, otherEmail, "Paul van Brouwershaven");

  await expect(page.getByRole("button", { name: "Message — not available yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow — not available yet" })).toBeVisible();

  // The skills are vouchable: each chip is a toggle carrying its own state.
  const skills = page.getByRole("region", { name: "Skills" });
  await expect(skills.getByRole("button", { name: "Signature validation" })).toHaveAttribute(
    "aria-pressed",
    /true|false/,
  );
  await expect(skills).toContainText("only members who share a group can vouch");

  // ── The reader's own record ───────────────────────────────────────────────
  // The seeded staff account has no name, so its record is headed by its
  // address.
  await openUserRecord(page, viewerEmail, viewerEmail);

  // Neither action means anything pointed at yourself, so neither is offered.
  await expect(page.getByRole("button", { name: "Message — not available yet" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Follow — not available yet" })).toHaveCount(0);

  // The record is still the reader's to administer: the actions menu is there
  // and the account section opens, which is what "your own record" means for a
  // staff account rather than a reduced page.
  await expect(page.getByRole("button", { name: "Record actions" })).toBeVisible();
  await page.getByRole("button", { name: "Account administration", exact: true }).click();
  await page.getByRole("menuitem", { name: "Show account administration" }).click();
  await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
});
