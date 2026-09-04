/**
 * What a member can do for themselves and for their colleagues.
 *
 * Staff-side identity management is covered. The member-side equivalent
 * is not, and it is the path most people actually use: an organization contact
 * adding a colleague from their own profile, and — the half that was missing
 * entirely — taking that access away again. Joining and leaving a working
 * group, and choosing whether to receive its mail, are the same story: real
 * self-service, previously only exercised as staff or not at all.
 */
import { runRowAction } from "./helpers/data-table";
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { approveMemberThroughReview, readActiveIdentities, uniqueSuffix } from "./helpers/membership";

/** An open working group anyone eligible may join without an invitation. */
const OPEN_WORKING_GROUP = "20000000-0000-4000-8000-000000000003";
const ALL_MEMBERS_GROUP = "20000000-0000-4000-8000-000000000001";

/**
 * The profile lists only active organization identities, so an ended identity
 * disappears from it entirely. Presence is therefore the signal, and it is a
 * stronger one than a status flag: it is what the rest of the portal reads.
 */
async function activeIdentityEmails(page: Page): Promise<string[]> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/users/current", { credentials: "same-origin" });
    return {
      status: response.status,
      body: (await response.json()) as {
        organizationIdentities: Array<{ email: string }> | null;
      },
    };
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return (result.body.organizationIdentities ?? []).map((identity) => identity.email);
}

test("an organization contact adds a colleague and can take the access away again", async ({ page }) => {
  const suffix = uniqueSuffix();
  const contactEmail = `contact-${suffix}@contact-${suffix}.test`;
  const colleagueEmail = `colleague-${suffix}@contact-${suffix}.test`;
  const organizationName = `Colleague Org ${suffix}`;
  page.on("dialog", (dialog) => void dialog.accept());

  await signInToPortal(page, e2eAdminEmail("portal-colleague-self-service"));
  await approveMemberThroughReview(page, {
    email: contactEmail,
    name: `Org Contact ${suffix}`,
    organizationName,
  });

  await page.context().clearCookies();
  await signInToPortal(page, contactEmail);
  await page.goto("/portal/#/profile");

  // Adding a colleague is a member action, not a staff one.
  const addCoworker = page.getByRole("button", { name: "Add coworker" });
  await expect(addCoworker).toBeVisible({ timeout: 15_000 });
  await addCoworker.click();
  const form = page.locator("form").filter({ has: page.locator('input[name="email"]') });
  await expect(form).toBeVisible();
  await form.locator('input[name="name"]').fill(`Colleague ${suffix}`);
  await form.locator('input[name="email"]').fill(colleagueEmail);
  const added = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/identities$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Add coworker" }).click();
  expect((await added).status()).toBe(201);
  await expect(page.getByText(colleagueEmail, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // The invitation does not grant capacity until the exact colleague accepts it.
  await page.context().clearCookies();
  await signInToPortal(page, colleagueEmail);
  await page.goto("/portal/#/account");
  const accepted = page.waitForResponse(
    (response) =>
      /\/api\/v1\/users\/current\/identities\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PATCH",
  );
  /*
   * Accepting reloads the portal so the session is rebuilt with the new
   * capacity (see AccountSettings). The wait is armed before the click, not
   * after: registered afterwards it resolves against the page that is already
   * loaded, and the reload then lands in the middle of the evaluate below —
   * "Execution context was destroyed".
   */
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Accept identity" }).click();
  expect((await accepted).status()).toBe(200);
  await reloaded;

  // The accepted identity now grants organization-derived membership.
  const colleagueMemberships = await readActiveIdentities(page);
  expect(
    colleagueMemberships.map((membership) => membership.organizationName),
    JSON.stringify(colleagueMemberships),
  ).toContain(organizationName);

  // Removing that access again is the half that had no coverage.
  await page.context().clearCookies();
  await signInToPortal(page, contactEmail);
  await page.goto("/portal/#/profile");
  const identityRow = page.getByRole("row").filter({ hasText: `Colleague ${suffix}` });
  await expect(identityRow).toBeVisible({ timeout: 15_000 });
  await runRowAction(page, identityRow, "End identity");
  await acceptConfirmDialog(page, "End identity");
  await expect(page.locator(".my-toast", { hasText: "Identity ended" })).toBeVisible({ timeout: 15_000 });

  // Ended history is immutable; a later role period requires a successor identity.
  await expect.poll(async () => await activeIdentityEmails(page)).not.toContain(colleagueEmail);
});

test("a member joins an open working group, sets their mail preference, and leaves again", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `wg-member-${suffix}@wg-member-${suffix}.test`;
  page.on("dialog", (dialog) => void dialog.accept());

  await signInToPortal(page, e2eAdminEmail("portal-group-self-service"));
  await approveMemberThroughReview(page, {
    email,
    name: `Working Group Member ${suffix}`,
    organizationName: `Working Group Org ${suffix}`,
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  const memberships = await readActiveIdentities(page);
  expect(memberships.length).toBeGreaterThan(0);

  const joined = await page.evaluate(async (groupId) => {
    const response = await fetch(`/api/v1/groups/${groupId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
    });
    return { status: response.status, body: await response.json() };
  }, OPEN_WORKING_GROUP);
  expect(joined.status, JSON.stringify(joined.body)).toBe(200);

  // Mail preference is a per-list choice, independent of participation.
  const lists = await page.evaluate(async (groupId) => {
    const response = await fetch(`/api/v1/groups/${groupId}/mailing-lists`, { credentials: "same-origin" });
    return {
      status: response.status,
      body: (await response.json()) as { subscriptions: Array<{ mailingList: { id: string } }> },
    };
  }, ALL_MEMBERS_GROUP);
  expect(lists.status, JSON.stringify(lists.body)).toBe(200);
  expect(lists.body.subscriptions.length, "the all-members group must offer a list").toBeGreaterThan(0);
  const listId = lists.body.subscriptions[0].mailingList.id;

  for (const preference of ["unsubscribed", "subscribed", "inherit"]) {
    const updated = await page.evaluate(
      async ({ groupId, listId, preference }) => {
        const response = await fetch(`/api/v1/groups/${groupId}/mailing-lists/${listId}/subscription`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ preference }),
        });
        return { status: response.status, body: await response.json() };
      },
      { groupId: ALL_MEMBERS_GROUP, listId, preference },
    );
    expect(updated.status, `setting preference ${preference}: ${JSON.stringify(updated.body)}`).toBe(200);
  }

  // Leaving is the part a member must be able to do without asking anyone.
  const left = await page.evaluate(async (groupId) => {
    const response = await fetch(`/api/v1/groups/${groupId}/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ mode: "all" }),
    });
    return { status: response.status, body: (await response.json()) as { memberships: unknown[] } };
  }, OPEN_WORKING_GROUP);
  expect(left.status, JSON.stringify(left.body)).toBe(200);
  expect(left.body.memberships, "leaving must end every capacity in that group").toEqual([]);
});
