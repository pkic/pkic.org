/**
 * What a member can do for themselves and for their colleagues.
 *
 * Staff-side representative management is covered. The member-side equivalent
 * is not, and it is the path most people actually use: an organization contact
 * adding a colleague from their own profile, and — the half that was missing
 * entirely — taking that access away again. Joining and leaving a working
 * group, and choosing whether to receive its mail, are the same story: real
 * self-service, previously only exercised as staff or not at all.
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, readActiveMemberships, uniqueSuffix } from "./helpers/membership";

/** An open working group anyone eligible may join without an invitation. */
const OPEN_WORKING_GROUP = "20000000-0000-4000-8000-000000000003";
const ALL_MEMBERS_GROUP = "20000000-0000-4000-8000-000000000001";

/**
 * The profile lists only *active* representatives, so a blocked colleague
 * disappears from it entirely. Presence is therefore the signal, and it is a
 * stronger one than a status flag: it is what the rest of the portal reads.
 */
async function activeRepresentativeEmails(page: Page): Promise<string[]> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/users/current", { credentials: "same-origin" });
    return {
      status: response.status,
      body: (await response.json()) as {
        organizationRepresentatives: Array<{ email: string }> | null;
      },
    };
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return (result.body.organizationRepresentatives ?? []).map((representative) => representative.email);
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
  const form = page.locator("form").filter({ has: addCoworker });
  await form.locator('input[name="name"]').fill(`Colleague ${suffix}`);
  await form.locator('input[name="email"]').fill(colleagueEmail);
  const added = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/representatives$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await addCoworker.click();
  expect((await added).status()).toBe(201);
  await expect(page.getByText(colleagueEmail, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // The colleague really gained organization-derived membership, not just a
  // row in a roster.
  await page.context().clearCookies();
  await signInToPortal(page, colleagueEmail);
  const colleagueMemberships = await readActiveMemberships(page);
  expect(
    colleagueMemberships.map((membership) => membership.organizationName),
    JSON.stringify(colleagueMemberships),
  ).toContain(organizationName);

  // Removing that access again is the half that had no coverage.
  await page.context().clearCookies();
  await signInToPortal(page, contactEmail);
  await page.goto("/portal/#/profile");
  const blockButton = page.getByRole("button", { name: new RegExp(`Block Colleague ${suffix} as representative`) });
  await expect(blockButton).toBeVisible({ timeout: 15_000 });
  await blockButton.click();
  await expect(page.locator(".my-toast", { hasText: "Representative blocked" })).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => await activeRepresentativeEmails(page)).not.toContain(colleagueEmail);

  // A block is a consent decision that persists until it is explicitly undone.
  const restoreButton = page.getByRole("button", {
    name: new RegExp(`Restore Colleague ${suffix} as representative`),
  });
  await expect(restoreButton).toBeVisible({ timeout: 15_000 });
  await restoreButton.click();
  await expect(page.locator(".my-toast", { hasText: "Representative restored" })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => await activeRepresentativeEmails(page)).toContain(colleagueEmail);
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
  const memberships = await readActiveMemberships(page);
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
