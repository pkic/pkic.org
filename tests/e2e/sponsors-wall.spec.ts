/**
 * @covers sponsor.2.5
 */
import { expect, test } from "@playwright/test";

const eventSponsorsPath = "/events/2026/pqc-conference-amsterdam-nl/sponsors/";

test("uses the canonical event slug and loads the next bounded sponsor page on demand", async ({ page }) => {
  const requestedOffsets: string[] = [];

  await page.route("**/api/v1/sponsors/display?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("eventSlug")).toBe("pqc-conference-amsterdam-nl");
    expect(query.has("eventName")).toBe(false);
    expect(query.get("limit")).toBe("200");
    expect(query.get("sort")).toBe("-weight");

    const offset = query.get("offset") ?? "0";
    requestedOffsets.push(offset);
    const isFirstPage = offset === "0";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        groups: [
          {
            weight: isFirstPage ? 8 : 5,
            tierName: isFirstPage ? "Leader" : "Supporter",
            sponsors: [
              {
                id: isFirstPage ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002",
                name: isFirstPage ? "First sponsor" : "Second sponsor",
                website: "https://example.com/",
                logoUrl: "/favicon.ico",
                tier: null,
                eventTier: isFirstPage ? "Leader" : "Supporter",
                effectiveTier: isFirstPage ? "Leader" : "Supporter",
                weight: isFirstPage ? 8 : 5,
              },
            ],
          },
        ],
        page: {
          limit: 200,
          offset: Number(offset),
          total: 2,
          hasMore: isFirstPage,
        },
      }),
    });
  });

  await page.goto(eventSponsorsPath);

  await expect(page.getByRole("img", { name: /First sponsor/ })).toBeVisible();
  await page.getByRole("button", { name: "Load more sponsors" }).click();
  await expect(page.getByRole("img", { name: /Second sponsor/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more sponsors" })).toHaveCount(0);
  expect(requestedOffsets).toEqual(["0", "1"]);
});
