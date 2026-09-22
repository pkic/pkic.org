/**
 * A group's leadership, at addresses of its own.
 *
 * Adding a leader and editing a term used to unfold above the table — a form
 * with no address, so it could not be linked to, reloaded, or opened cold.
 * They are pages now, `/leadership/add` and `/leadership/:userRoleId`,
 * following the Members roster idiom exactly (#40's rule, applied here while
 * fixing #19, #26 and #29).
 *
 * What this proves is what only a browser can: the two addresses exist and
 * survive a reload, the title is a choice rather than a text box (#29), the
 * picker searches as the reader types rather than behind a Search button
 * (#26), and a term carries a start date so no page has to render "In role
 * since Invalid Date" (#19).
 * @covers groups.8.9
 */
import { userDetailResponseSchema, userUpdateSchema } from "../../assets/shared/schemas/user-management";
import { identityUpdateSchema } from "../../assets/shared/schemas/identity";
import { agreeToHeadshotTerms, chooseHeadshotThroughUploadButton } from "./helpers/headshot-upload";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { createMember } from "./helpers/member-provisioning";
import { signInToPortal } from "./helpers/portal-auth";

test.use({ timezoneId: "America/Los_Angeles" });

for (const scenario of [
  { group: "board", individual: false },
  { group: "executive-council", individual: true },
]) {
  test(`staff manage current and past ${scenario.group} leadership for ${scenario.individual ? "an independent" : "an organization"} member`, async ({
    page,
  }) => {
    await signInToPortal(page, e2eAdminEmail("portal-group-leadership"));
    // A term needs a person who participates in the group, so one is
    // provisioned the way the product does it.
    const leader = await createMember(page, { individual: scenario.individual });
    const name = `Portrait leader ${Date.now()}`;
    const renamed = await page.request.patch(`/api/v1/users/${leader.userId}`, {
      data: userUpdateSchema.parse({ firstName: name, lastName: null }),
    });
    expect(renamed.status(), await renamed.text()).toBe(200);

    await page.goto(`/portal/#/users/${leader.userId}`);
    await chooseHeadshotThroughUploadButton(page);
    const crop = await agreeToHeadshotTerms(page);
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/users/${leader.userId}/headshot`) && response.request().method() === "PUT",
    );
    await crop.locator(".crop-headshot-confirm").click();
    expect((await uploaded).status()).toBe(200);
    const user = userDetailResponseSchema.parse(
      await (await page.request.get(`/api/v1/users/${leader.userId}`)).json(),
    ).user;
    const organizationId = user.identities.find(
      (identity) => identity.identityId === leader.identityId,
    )?.organizationId;
    expect(Boolean(organizationId)).toBe(!scenario.individual);
    if (organizationId) {
      const profile = await page.request.patch(
        `/api/v1/organizations/${organizationId}/identities/${leader.identityId}`,
        {
          data: identityUpdateSchema.parse({
            profile: {
              links: [
                "https://github.com/pkic",
                "https://www.linkedin.com/company/pki-consortium/",
                "https://example.test/leader",
              ],
            },
          }),
        },
      );
      expect(profile.status(), await profile.text()).toBe(200);
    }

    const boardResponse = await page.request.get(`/api/v1/groups/${scenario.group}`);
    expect(boardResponse.status()).toBe(200);
    const boardId = ((await boardResponse.json()) as { group: { id: string } }).group.id;

    // A real document navigation rather than a hash change: see the note in
    // portal-group-roster.spec.ts — a page that canonicalizes its own address
    // in an effect races a hash-only navigation away from it.
    await page.goto(`/portal/?from=leadership#/groups/${boardId}/leadership`);
    const leadership = page.getByRole("region", { name: "Leadership", exact: true });
    await expect(leadership).toBeVisible({ timeout: 15_000 });

    await leadership.getByRole("button", { name: "Add leadership" }).first().click();

    // Adding is a page, not a panel unfolding above the table it adds to.
    await expect(page).toHaveURL(new RegExp(`#/groups/${boardId}/leadership/add$`));
    const addLeadership = page.getByRole("region", { name: "Add leadership" });
    await expect(addLeadership).toBeVisible();
    await expect(leadership).toHaveCount(0);

    // #26: the person is found as the reader types. No Search button stands
    // between typing a name and seeing the matches.
    const participant = addLeadership.getByRole("combobox", { name: "Participant" });
    await expect(participant).toHaveAttribute("aria-autocomplete", "list");
    await expect(addLeadership.getByRole("button", { name: "Search" })).toHaveCount(0);
    await participant.fill(leader.email);
    // Named by the person, not taken as "the first option on the page": the
    // Role and Title selects beside this one are native <select>s, whose
    // <option>s carry the same role, so an unqualified option locator picks one
    // of those and the assignment is never given anybody.
    const candidate = addLeadership.getByRole("option", { name: new RegExp(name) }).first();
    await expect(candidate).toBeVisible();
    await candidate.click();

    // #29: the title is chosen from the group's configured vocabulary, which
    // comes from reference data — it is not a text box asking the manager to
    // know what a chair is called here.
    const title = addLeadership.getByLabel("Title", { exact: false });
    await expect(title).toHaveRole("combobox");
    await expect(title.locator("option")).not.toHaveCount(0);
    await title.selectOption({ label: "Chair" });

    // #19: a term has a start, so nothing downstream has to invent one.
    await addLeadership.getByLabel("Term starts", { exact: false }).fill("2026-03-01");

    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith(`/api/v1/groups/${boardId}/leadership`) &&
        response.request().method() === "POST",
    );
    await addLeadership.getByRole("button", { name: "Assign leadership" }).click();
    expect((await created).status()).toBeLessThan(300);

    // And it returns to the roster it added to.
    await expect(page).toHaveURL(new RegExp(`#/groups/${boardId}/leadership$`));
    const row = leadership.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();

    const search = leadership.getByRole("searchbox");
    await search.fill(name);
    await search.press("Enter");
    await expect(row).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() =>
          row.evaluate((element) => {
            const frame = element.closest(".pk-table__scroll")!;
            return frame.scrollWidth <= frame.clientWidth + 1;
          }),
        )
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      await page.screenshot({
        path: `/Volumes/ScanDisk/mac-caches/tmp/pr180-leadership-${scenario.group}-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Editing is a command in the row's own menu that navigates to the term's
    // address — the record never arrives in edit mode (#47).
    await row.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Edit term" }).click();
    await expect(page).toHaveURL(new RegExp(`#/groups/${boardId}/leadership/[^/]+$`));

    // The address is real: opening it cold resolves the term rather than
    // depending on state left behind by the click that reached it.
    const termUrl = page.url();
    await page.reload();
    await expect(page.getByLabel("Term starts", { exact: false })).toHaveValue("2026-03-01", { timeout: 15_000 });
    expect(page.url()).toBe(termUrl);

    // A term that does not exist returns to the list rather than sitting on an
    // address that resolves to nothing.
    await page.goto(`/portal/?from=leadership#/groups/${boardId}/leadership/00000000-0000-4000-8000-000000000000`);
    await expect(page).toHaveURL(new RegExp(`#/groups/${boardId}/leadership$`), { timeout: 15_000 });

    await page.goto(`/about/${scenario.group}/`);
    const current = page.locator('[data-positions="current"] .person-card').filter({ hasText: name });
    await expect(current).toBeVisible();
    const currentPhoto = current.locator("img.person-card-avatar");
    await expect
      .poll(() => currentPhoto.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    if (!scenario.individual)
      await expect(current.locator('a.pk-link-list__link[href="https://github.com/pkic"]')).toBeVisible();
    await expect(current).toContainText("Mar 1, 2026");

    /*
     * #25: a closed term is drawn as the same tile a current one is, on the
     * public page that publishes the board. It used to have a whole parallel
     * set of markup beside the card it was meant to resemble, so every fix to
     * the real card had to be made twice and was not.
     */
    await page.goto(`/portal/?from=leadership#/groups/${boardId}/leadership`);
    const currentRow = leadership.getByRole("row").filter({ hasText: name });
    await expect(currentRow).toBeVisible({ timeout: 15_000 });
    const ended = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith(`/api/v1/groups/${boardId}/leadership`) &&
        ["DELETE", "PATCH"].includes(response.request().method()),
    );
    await currentRow.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "End term now" }).click();
    // Ending a term is confirmed: it removes somebody's authority here.
    await acceptConfirmDialog(page, "End term");
    expect((await ended).status()).toBeLessThan(300);

    await page.goto(`/about/${scenario.group}/`);
    const past = page.locator('[data-positions="past"] .person-card').filter({ hasText: name });
    await expect(past).toBeVisible({ timeout: 15_000 });
    // The same card, not a second rendering of one: it names the person, states
    // the closed term, and carries the portrait's place rather than a gap.
    await expect(past.locator(".person-card-name")).toHaveText(name);
    await expect(past).toContainText("Mar 1, 2026");
    const pastPhoto = past.locator("img.person-card-avatar");
    await expect.poll(() => pastPhoto.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    if (!scenario.individual)
      await expect(past.locator('a.pk-link-list__link[href="https://github.com/pkic"]')).toBeVisible();
    // Public cards intentionally publish the featured link, not every profile link.
    await expect(past.locator("a.pk-link-list__link")).toHaveCount(scenario.individual ? 0 : 1);
    const portraitGeometry = await pastPhoto.evaluate((image) => {
      const photo = image.getBoundingClientRect();
      const frame = image.parentElement!.getBoundingClientRect();
      const style = getComputedStyle(image.parentElement!);
      const horizontalInset =
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.borderRightWidth) +
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight);
      const verticalInset =
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth) +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom);
      return {
        width: photo.width,
        height: photo.height,
        frameWidth: frame.width - horizontalInset,
        frameHeight: frame.height - verticalInset,
        fit: getComputedStyle(image).objectFit,
      };
    });
    expect(portraitGeometry.fit).toBe("cover");
    expect(Math.abs(portraitGeometry.width - portraitGeometry.height)).toBeLessThan(1);
    expect(Math.abs(portraitGeometry.width - portraitGeometry.frameWidth)).toBeLessThan(1);
    expect(Math.abs(portraitGeometry.height - portraitGeometry.frameHeight)).toBeLessThan(1);

    /*
     * #25 came back twice as "the image is an oval", and both times the fix was
     * reported without anything able to see it: every assertion here is about
     * roles and text, and a portrait stretched into an ellipse satisfies all of
     * them. A round frame is `border-radius: 50%` over a SQUARE box — the
     * moment the box stops being square the same radius draws an oval, which is
     * what a flex parent stretching its child produced.
     *
     * Measured on every governance portrait the page draws, current and past,
     * because the two were separate markup once and the fix reached only one.
     */
    const frames = page.locator(".person-card-avatar-frame");
    const count = await frames.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
      const box = (await frames.nth(index).boundingBox())!;
      expect(Math.abs(box.width - box.height), `portrait ${index} is square`).toBeLessThan(1);
    }
  });
}
