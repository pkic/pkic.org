/** @covers event.3.3 presentation.13.7 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

for (const colorScheme of ["light", "dark"] as const) {
  test(`application workflow has readable labels without backgrounds in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/application-process/");
    const diagram = page.locator(".mermaid-wrap").first();
    await expect(diagram.locator("svg")).toBeVisible();
    for (const text of ["Yes", "No", "Everything looks good", "Questions", "Approved", "No answer"]) {
      const label = diagram.getByText(text, { exact: true });
      await expect(label).toHaveCSS("color", "rgb(0, 0, 0)");
      // Check the visible label and every wrapper up to the SVG. A background
      // on a generated Mermaid wrapper is just as visible as one on the text.
      const backgrounds = await label.evaluate((element) => {
        const colors: string[] = [];
        for (
          let node: Element | null = element;
          node && node.tagName.toLowerCase() !== "svg";
          node = node.parentElement
        ) {
          colors.push(getComputedStyle(node).backgroundColor);
        }
        return colors;
      });
      expect(backgrounds).toEqual(backgrounds.map(() => "rgba(0, 0, 0, 0)"));
    }
    await diagram.screenshot({ path: test.info().outputPath(`workflow-${colorScheme}.png`) });
  });
}

test("Next sorts the displayed dates of ordinary group events in both directions", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-user-create"));
  const groupId = "20000000-0000-4000-8000-000000000003";
  const prefix = `Sorting workshop ${Date.now()}`;
  const names = await page.evaluate(
    async ({ groupId, prefix }) => {
      const names: string[] = [];
      for (const month of [9, 2, 6]) {
        const name = `${prefix} ${month}`;
        const date = `2027-${String(month).padStart(2, "0")}-01`;
        const response = await fetch(`/api/v1/groups/${groupId}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            slug: `${prefix.toLowerCase().replaceAll(" ", "-")}-${month}`,
            timezone: "UTC",
            startsAt: `${date}T08:00:00.000Z`,
            endsAt: `${date}T09:00:00.000Z`,
            profileKey: "workshop",
            registrationPolicy: "no_registration",
            location: "Online",
            links: [],
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        names.push(name);
      }
      return names;
    },
    { groupId, prefix },
  );
  await page.goto(`/portal/#/groups/${groupId}/events`);
  const search = page.getByPlaceholder("Search events…");
  await search.fill(prefix);
  await search.press("Enter");
  const rows = page.getByRole("row").filter({ hasText: prefix });
  await expect(rows).toHaveCount(3);
  // Next defaults to ascending, so exercise a change in both directions.
  for (const direction of ["descending", "ascending"] as const) {
    const expected = direction === "ascending" ? [names[1], names[2], names[0]] : [names[0], names[2], names[1]];
    expect(await rows.allTextContents()).not.toEqual(expected.map((name) => expect.stringContaining(name)));
    await page.getByRole("button", { name: "Next column options" }).click();
    await page.getByRole("menuitemradio", { name: `Sort ${direction}`, exact: true }).click();
    await expect
      .poll(async () => rows.allTextContents())
      .toEqual(expected.map((name) => expect.stringContaining(name)));
  }
  await page.screenshot({ path: test.info().outputPath("sorted-events.png"), fullPage: true });
});
