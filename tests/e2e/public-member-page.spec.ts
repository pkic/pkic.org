/**
 * The public member page, in a browser.
 *
 * Three of the four things reported against it are only true in a browser:
 * the address in the location bar (#15), whether a link is drawn as a badge or
 * printed as an address (#13), and whether a shortcode becomes an embed or
 * shows the reader its own braces (#12). Unit tests pin each of those at its
 * component; this pins them where the reader meets them, on the record the
 * e2e seed writes.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("a member's page answers on its name, embeds its video, and marks its links", async ({ page }) => {
  // The readable address, not `/members/profile/?id=<uuid>`. This is the exact
  // shape the Hugo pages had, which is why nothing outside the site has to
  // change (#15).
  const response = await page.goto("/members/digitorus/");
  expect(response?.status()).toBe(200);
  expect(page.url()).toContain("/members/digitorus/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Digitorus");

  // The shortcode a member writes resolves to the embed it always meant, and
  // the reader is never shown `{{< … >}}` (#12).
  const embed = page.locator('iframe[title="Embedded video"]');
  await expect(embed).toHaveCount(1);
  await expect(embed).toHaveAttribute("src", "https://www.youtube.com/embed/HGoZW7MCF60");
  await expect(page.locator("body")).not.toContainText("{{<");

  /*
   * The representative's profile link, as a mark and the site's name rather
   * than the address itself (#13). The seeded identity's first link is the
   * organization's own site, so the label is the host the shared table has no
   * special name for — which is the point: no platform is special.
   */
  const badge = page.locator("a.pk-link-list__link").first();
  await expect(badge).toHaveCount(1);
  await expect(badge.locator(".pk-link-list__label")).toHaveText("digitorus.com");
  await expect(badge).toHaveAttribute("href", "https://digitorus.com");
  // Preserve all representative links, including links after the featured one.
  await expect(page.getByRole("link", { name: /on LinkedIn/ })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const details = page.getByRole("heading", { name: "Member details", exact: true }).locator("../..");
  const content = details.locator("..").locator(":scope > div");
  const contentBox = await content.boundingBox();
  const detailsBox = await details.boundingBox();
  expect(contentBox!.width).toBeGreaterThan(detailsBox!.width * 1.5);
  await page.screenshot({ path: test.info().outputPath("member-content-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileContent = await content.boundingBox();
  const mobileDetails = await details.boundingBox();
  expect(mobileDetails!.y).toBeGreaterThanOrEqual(mobileContent!.y + mobileContent!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("member-content-mobile.png"), fullPage: true });
  // The address stays reachable without being printed.
  await expect(badge).toHaveAttribute("title", "https://digitorus.com");
});

test("the members directory links a member by name, not by id", async ({ page }) => {
  await page.goto("/members/");
  const card = page.locator('.member-card a.pk-stretched[aria-label="Digitorus"]');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("href", "/members/digitorus/");
});

/**
 * The public site is public for everybody, including a reader who is signed in.
 *
 * `/api/v1/members` answers in two shapes, and it used to choose by whether
 * the reader held `membership:read`. So the directory received staff rows the
 * moment a staff member looked at it — rows carrying no slug, no logo and no
 * website — could not read them, and showed an error where the members should
 * be. Issues #11, #13 and #25 are all that, and none of it ever reproduced
 * signed out, which is the whole reason no test caught it: every public-page
 * spec here was anonymous, and every authenticated spec stayed in the portal.
 */
test("the members directory renders for a signed-in staff reader, the same as for anyone", async ({ page }) => {
  const anonymousNames = async () => {
    await page.goto("/members/");
    const cards = page.locator(".member-card");
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    return cards.allTextContents();
  };

  const before = await anonymousNames();
  expect(before.length).toBeGreaterThan(0);

  await signInToPortal(page, e2eAdminEmail("public-members-signed-in"));
  await page.goto("/members/");

  // The same members, and nothing telling the reader the page broke.
  const cards = page.locator(".member-card");
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  expect(await cards.allTextContents()).toEqual(before);
  await expect(page.getByText("could not read", { exact: false })).toHaveCount(0);

  // And the independent roll, which failed the same way.
  await page.goto("/members/independent/");
  await expect(page.getByText("could not read", { exact: false })).toHaveCount(0);
});

/**
 * #15's second half: an organization created in the portal, not imported.
 *
 * The first report was about migrated members, and those were fine because
 * the YAML import carried a hand-written id per member. What came back was
 * "creating a new organization in the UI the URL is still using the ID" —
 * nothing but the import had ever written `organizations.slug`, so a member
 * admitted through the portal fell back to `/members/profile/?id=<uuid>`.
 *
 * Walked from the creation, because that is the difference: the seeded member
 * the test above uses is the imported case, and it passed throughout.
 */
test("an organization created in the portal gets a readable address too", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const name = `Slug Check Consultancy ${suffix}`;
  const expectedSlug = `slug-check-consultancy-${suffix}`;

  await signInToPortal(page, e2eAdminEmail("public-members-signed-in"));
  const created = await page.evaluate(async (organizationName) => {
    const response = await fetch("/api/v1/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        name: organizationName,
        membershipCategory: "F",
        memberSince: "2026-01-15",
        identities: [
          {
            name: "Release Review Person",
            email: `member-links-${organizationName.split(" ").at(-1)}@example.test`,
            links: ["https://www.linkedin.com/in/pkic-example", "https://x.com/pkic_example"],
          },
        ],
        workingGroupSlugs: [],
        activationReason: "E2E readable-address fixture",
      }),
    });
    return { status: response.status, body: await response.json() };
  }, name);
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  // Find the new member through the directory, including after its first page fills up.
  await page.goto("/members/");
  await page.getByLabel("Search members").fill(name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const card = page.locator(`.member-card a.pk-stretched[aria-label="${name}"]`);
  await expect(card).toHaveCount(1, { timeout: 15_000 });
  await expect(card).toHaveAttribute("href", `/members/${expectedSlug}/`);

  const response = await page.goto(`/members/${expectedSlug}/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible({ timeout: 15_000 });
  // And no id anywhere in the address the reader ends up on.
  expect(page.url()).not.toContain("id=");
  await expect(
    page.getByRole("link", { name: "Release Review Person on LinkedIn (opens in a new tab)", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Release Review Person on X (Twitter) (opens in a new tab)", exact: true }),
  ).toBeVisible();
});
