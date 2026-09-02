/**
 * Group vote MANAGEMENT: the lifecycle actions (open/close/cancel), the
 * proposal endorse/withdraw/reject/approve set, and the Sharing facet had
 * zero end-to-end coverage through the rendered UI. `vote-participation.spec.ts`
 * (not this file's territory) proves ballot casting; `portal-management-verification.spec.ts`
 * proves a bare create → visibility save → empty Ballots tab. Neither ever
 * clicks "Open vote now", "Close current round", "Cancel vote", the
 * proposal-detail action buttons, or the Sharing form — every transition in
 * both of those specs happens through a raw `fetch` call instead. This file
 * drives those through the real UI.
 *
 * Staff authentication happens once for the whole file (`beforeAll`, saved as
 * `storageState`), the same way `portal-management-verification.spec.ts` and
 * `portal-groups.spec.ts` do it, to stay under the local EMAIL_RATE_LIMITER.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { openRow, runRowAction } from "./helpers/data-table";
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog, confirmDialog } from "./helpers/confirm-dialog";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";
import { signInToPortal } from "./helpers/portal-auth";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { expectCurrentTab, tab } from "./helpers/tabs";

/** Seeded Post-Quantum Cryptography Working Group, used as a stable fixture. */
const GROUP_ID = "20000000-0000-4000-8000-000000000003";
const ADMIN_AUTH_FILE = path.join("test-results", "portal-vote-management-auth.json");
const ADMIN_EMAIL = e2eAdminEmail("portal-vote-eligibility");

function isoLocal(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString().slice(0, 16);
}

/** Creates a scheduled motion vote and returns its id (parsed from the post-create URL). */
async function createScheduledMotion(page: Page, title: string): Promise<string> {
  await page.goto(`/portal/#/groups/${GROUP_ID}/votes/new`);
  const form = page.getByRole("form", { name: "Create vote" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Description").fill("Created end-to-end by a Playwright spec.");
  // Opens at is set well into the future, so the vote starts "scheduled"
  // rather than opening immediately (the default when left blank).
  await form.getByLabel("Opens at").fill(isoLocal(24 * 60 * 60 * 1000));
  await form.getByLabel("Closes at").fill(isoLocal(48 * 60 * 60 * 1000));
  await form.getByRole("button", { name: "Create vote", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/groups\/[^/]+\/votes\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const match = /\/votes\/([0-9a-fA-F-]{36})$/.exec(page.url());
  if (!match) throw new Error(`Could not read the created vote's id from ${page.url()}`);
  return match[1];
}

/** Waits for the vote record's own detail GET to complete — the fetch that `onChanged` triggers after a lifecycle transition, and the one the lifecycle buttons' visibility actually depends on. */
function voteDetailReloaded(page: Page, voteId: string) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/groups/${GROUP_ID}/votes/${voteId}` &&
      response.request().method() === "GET",
  );
}

test.describe("Group votes: lifecycle actions, proposal moderation, and sharing", () => {
  test.beforeAll(async ({ browser }) => {
    if (existsSync(ADMIN_AUTH_FILE)) return;
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await signInAsE2eStaff(page, ADMIN_EMAIL);
    await context.storageState({ path: ADMIN_AUTH_FILE });
    await context.close();
  });

  test.use({ storageState: ADMIN_AUTH_FILE });

  async function gotoAsAdmin(page: Page): Promise<void> {
    await page.goto("/portal/");
    // `expectStaffSessionLanding` hardcodes a 15s wait for #portal-root; the
    // proposal test in this file re-enters as admin after several full page
    // reloads already, so it gets a more patient wait here rather than
    // duplicating the helper's other assertions.
    await expect(page.locator("#portal-root")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/portal\/#\//);
    await expect(page.getByLabel("Email")).toHaveCount(0);
  }

  test("a manager opens a scheduled vote, then closes it, through the lifecycle actions", async ({ page }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Lifecycle Vote ${suffix}`;

    await gotoAsAdmin(page);
    const voteId = await createScheduledMotion(page, title);

    const voteTabs = page.getByRole("navigation", { name: `${title} sections` });
    await voteTabs.getByRole("link", { name: "Settings" }).click();
    const management = page.getByRole("region", { name: "Vote management" });
    await expect(management).toBeVisible();

    // Scheduled: only "Open vote now" and "Cancel vote" are on offer.
    const openButton = management.getByRole("button", { name: "Open vote now" });
    const closeButton = management.getByRole("button", { name: "Close current round" });
    const cancelButton = management.getByRole("button", { name: "Cancel vote" });
    await expect(openButton).toBeVisible();
    await expect(cancelButton).toBeVisible();
    await expect(closeButton).toHaveCount(0);

    let reloaded = voteDetailReloaded(page, voteId);
    await openButton.click();
    await expect(confirmDialog(page).getByText(`Open "${title}" now?`)).toBeVisible();
    const opened = page.waitForResponse((response) =>
      /\/votes\/[^/]+\/transitions$/.test(new URL(response.url()).pathname),
    );
    await acceptConfirmDialog(page, "Open vote");
    expect((await opened).status()).toBe(200);
    await reloaded;

    // Open: "Open vote now" is gone, "Close current round" and "Cancel vote" remain.
    await expect(openButton).toHaveCount(0);
    await expect(closeButton).toBeVisible();
    await expect(cancelButton).toBeVisible();

    reloaded = voteDetailReloaded(page, voteId);
    await closeButton.click();
    await expect(confirmDialog(page).getByText(`Close and tally "${title}" now?`)).toBeVisible();
    const closed = page.waitForResponse((response) =>
      /\/votes\/[^/]+\/transitions$/.test(new URL(response.url()).pathname),
    );
    await acceptConfirmDialog(page, "Close and tally");
    expect((await closed).status()).toBe(200);
    await reloaded;

    // Closed: no further transitions, so the lifecycle section renders nothing.
    await expect(closeButton).toHaveCount(0);
    await expect(cancelButton).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Vote lifecycle management" })).toHaveCount(0);
  });

  test("a manager backs out of cancelling a vote once, then cancels it with a reason", async ({ page }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Cancel Vote ${suffix}`;

    await gotoAsAdmin(page);
    const voteId = await createScheduledMotion(page, title);
    await page
      .getByRole("navigation", { name: `${title} sections` })
      .getByRole("link", { name: "Settings" })
      .click();
    const management = page.getByRole("region", { name: "Vote management" });

    const cancelToggle = management.getByRole("button", { name: "Cancel vote" });
    await cancelToggle.click();
    const cancelForm = management.getByRole("form", { name: `Cancel ${title}` });
    await expect(cancelForm).toBeVisible();
    const confirmCancellation = cancelForm.getByRole("button", { name: "Confirm cancellation" });
    await expect(confirmCancellation).toBeDisabled();

    // Backing out leaves the vote untouched and hides the form again.
    await cancelForm.getByRole("button", { name: "Keep vote" }).click();
    await expect(cancelForm).toHaveCount(0);
    await expect(management.getByRole("button", { name: "Open vote now" })).toBeVisible();

    const reloaded = voteDetailReloaded(page, voteId);
    await cancelToggle.click();
    await management.getByLabel("Cancellation reason").fill("No longer needed by the working group.");
    await expect(confirmCancellation).toBeEnabled();
    const cancelled = page.waitForResponse((response) =>
      /\/votes\/[^/]+\/transitions$/.test(new URL(response.url()).pathname),
    );
    await confirmCancellation.click();
    expect((await cancelled).status()).toBe(200);
    await reloaded;
    await expect(page.getByRole("region", { name: "Vote lifecycle management" })).toHaveCount(0);
  });

  test("a member proposes a vote, endorses and withdraws their own endorsement, then staff rejects it", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const email = `vote-proposer-${suffix}@vote-proposer-${suffix}.test`;
    const title = `E2E Member Proposal ${suffix}`;

    await gotoAsAdmin(page);
    // Member proposal submission requires the owning group's canonical
    // min_endorsers_for_ballot policy to be enabled (see
    // portal-management-verification.spec.ts's equivalent fixture setup).
    // Set to 2, not 1: a single endorsement meeting the threshold converts
    // the proposal straight into a vote (see `endorseGroupVoteProposal`'s
    // `convertedVote`), which would leave nothing to withdraw the
    // endorsement from and drop the proposal out of the member's own view
    // (a converted proposal is no longer `open_for_endorsement`).
    const settingsStatus = await page.evaluate(async (groupId) => {
      const current = await fetch(`/api/v1/groups/${groupId}`, { credentials: "same-origin" });
      if (!current.ok) return current.status;
      const currentBody = (await current.json()) as { group: { revision: number } };
      const res = await fetch(`/api/v1/groups/${groupId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ expectedRevision: currentBody.group.revision, minEndorsersForBallot: 2 }),
      });
      return res.status;
    }, GROUP_ID);
    expect(settingsStatus).toBe(200);

    await approveMemberThroughReview(page, {
      email,
      name: `Vote Proposer ${suffix}`,
      organizationName: `Vote Proposer Org ${suffix}`,
    });

    await page.context().clearCookies();
    await signInToPortal(page, email);
    await page.evaluate(async (groupId) => {
      await fetch(`/api/v1/groups/${groupId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
      });
    }, GROUP_ID);

    await page.goto(`/portal/#/groups/${GROUP_ID}/votes`);
    await tab(page, "Proposals").click();
    await expectCurrentTab(page, "Proposals");
    await page.getByRole("button", { name: "Propose a vote" }).click();
    const proposeForm = page.getByRole("form", { name: "Propose a vote" });
    await expect(proposeForm).toBeVisible();
    await proposeForm.getByLabel("Title").fill(title);
    // Required fields carry a hidden "(required)" suffix inside the <label>,
    // so their accessible name is not exactly the visible text — substring
    // matching (the getByLabel default) is what every other field in this
    // file already relies on.
    await proposeForm.getByLabel("Description").fill("A member-submitted proposal, via the UI.");
    const submitted = page.waitForResponse(
      (response) =>
        /\/vote-proposals$/.test(new URL(response.url()).pathname) && response.request().method() === "POST",
    );
    await proposeForm.getByRole("button", { name: "Submit proposal" }).click();
    expect((await submitted).status()).toBe(200);
    // A successful submit reloads the table and clears the form's own fields,
    // but leaves the disclosure itself open (only the toggle button hides
    // it) — the new row shows up in the list alongside the still-open form.
    await expect(proposeForm.getByLabel("Title")).toHaveValue("");

    const proposalRow = page
      .getByRole("row")
      .filter({ hasText: title })
      .filter({ has: page.getByRole("button", { name: new RegExp(`^(?:Show|Hide) details for ${title}$`) }) });

    // The row's detail panel closes itself after every mutating action (the
    // list reload that follows also clears the open selection). Rather than
    // race that client-side reload, each reopen below starts from a fresh
    // navigation: a clean read of the server's current truth, and proof the
    // change actually persisted rather than merely appearing to.
    async function openDetail() {
      // `goto` alone is a same-document hash change when the hash is already
      // "#/groups/{id}/votes" (e.g. immediately after the previous reopen),
      // which a hash router does not remount for — `reload` after it forces
      // an actual fresh fetch every time, regardless of where the previous
      // step left the page.
      await page.goto(`/portal/#/groups/${GROUP_ID}/votes`);
      await page.reload();
      await tab(page, "Proposals").click();
      await expectCurrentTab(page, "Proposals");
      await expect(proposalRow).toBeVisible({ timeout: 15_000 });
      // This row's action is the whole-row "activate" control (a stretched
      // link/button, opened the way the keyboard does), not a `RowActions`
      // menu — `openRow` targets that directly rather than probing for an
      // "Actions for …" menu that this row never renders.
      await openRow(proposalRow, `Show details for ${title}`);
      const region = page.getByRole("region", { name: title });
      await expect(region).toBeVisible();
      return region;
    }

    let detail = await openDetail();
    await expect(detail.getByText("0 of ")).toBeVisible();
    // The proposer holds both "endorse" and "withdraw" (they may withdraw
    // their own proposal), but not "withdraw endorsement" until they endorse.
    await expect(detail.getByRole("button", { name: "Withdraw endorsement" })).toHaveCount(0);
    const endorsed = page.waitForResponse((response) =>
      /\/vote-proposals\/[^/]+\/endorsement$/.test(new URL(response.url()).pathname),
    );
    await detail.getByRole("button", { name: "Endorse" }).click();
    expect((await endorsed).status()).toBe(200);

    detail = await openDetail();
    await expect(detail.getByText("1 of ")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Endorse", exact: true })).toHaveCount(0);
    const withdrawnEndorsement = page.waitForResponse(
      (response) =>
        /\/vote-proposals\/[^/]+\/endorsement$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "DELETE",
    );
    await detail.getByRole("button", { name: "Withdraw endorsement" }).click();
    expect((await withdrawnEndorsement).status()).toBe(200);

    detail = await openDetail();
    await expect(detail.getByText("0 of ")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Endorse" })).toBeVisible();

    // Staff moderates: reject with a required reason. `gotoAsAdmin` only
    // re-lands on the storageState session established once in `beforeAll`;
    // once `clearCookies()` drops it (to sign in as the member above), only
    // a real sign-in — same as every other identity switch in this spec —
    // re-establishes it.
    await page.context().clearCookies();
    await signInToPortal(page, ADMIN_EMAIL);
    detail = await openDetail();
    const reject = detail.getByRole("button", { name: "Reject proposal" });
    await expect(reject).toBeDisabled();
    await detail.getByLabel("Rejection reason").fill("Out of scope for this working group.");
    await expect(reject).toBeEnabled();
    const rejected = page.waitForResponse((response) =>
      /\/vote-proposals\/[^/]+\/reject$/.test(new URL(response.url()).pathname),
    );
    await reject.click();
    expect((await rejected).status()).toBe(200);

    detail = await openDetail();
    await expect(detail.getByText("Rejected")).toBeVisible();
    await expect(detail.getByText("Out of scope for this working group.")).toBeVisible();
  });

  test("a manager shares a vote with another group, then revokes the grant", async ({ page }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Shared Vote ${suffix}`;

    await gotoAsAdmin(page);
    await createScheduledMotion(page, title);
    await page
      .getByRole("navigation", { name: `${title} sections` })
      .getByRole("link", { name: "Sharing" })
      .click();

    const sharing = page.getByRole("region", { name: "vote sharing" });
    await expect(sharing).toBeVisible();
    await expect(sharing.getByText("This resource is not shared with any other group.")).toBeVisible();

    const shareForm = sharing.getByRole("form", { name: "Share this vote" });
    await shareForm.getByLabel("Group").fill("Cryptographic Module");
    await page.getByRole("option", { name: /Cryptographic Module Working Group/ }).click();
    await shareForm.getByLabel("Capability").selectOption("participate");
    const shared = page.waitForResponse(
      (response) =>
        /\/votes\/[^/]+\/grants$/.test(new URL(response.url()).pathname) && response.request().method() === "POST",
    );
    await shareForm.getByRole("button", { name: "Share", exact: true }).click();
    expect((await shared).status()).toBe(201);
    await expect(sharing.getByText("Sharing grant saved.")).toBeVisible();

    const grantRow = sharing.getByRole("row").filter({ hasText: "Cryptographic Module Working Group" });
    await expect(grantRow).toBeVisible();
    await expect(grantRow).toContainText("participate");

    const revoked = page.waitForResponse(
      (response) =>
        /\/votes\/[^/]+\/grants\/[^/]+\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "DELETE",
    );
    await runRowAction(page, grantRow, "Revoke");
    await expect(
      confirmDialog(page).getByText("Revoke participate access for Cryptographic Module Working Group?"),
    ).toBeVisible();
    await acceptConfirmDialog(page, "Revoke access");
    expect((await revoked).status()).toBe(200);
    await expect(sharing.getByText("This resource is not shared with any other group.")).toBeVisible();
  });
});
