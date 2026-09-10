import { expect, test } from "@playwright/test";
import { XMLParser } from "fast-xml-parser";

const articlePath = "/2021/08/03/increasing-support-and-awareness-for-remote-key-attestation/";

test("member news arrives in the HTML and agrees with its RSS feed on desktop and phone", async ({
  page,
}, testInfo) => {
  const response = await page.goto("/news/");
  expect(response?.status()).toBe(200);
  const source = await response!.text();
  const feed = await page.request.get("/news/feed/");
  expect(feed.status()).toBe(200);
  const parsed = new XMLParser().parse(await feed.text(), true);
  const items = parsed.rss.channel.item;
  const first = Array.isArray(items) ? items[0] : items;
  if (first) {
    await expect(page.getByRole("link", { name: first.title, exact: true }).first()).toBeVisible();
    expect(source).toContain(first.link);
  } else {
    await expect(page.getByText("No news items available at this time.")).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Latest Member News", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("member-news-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Latest Member News", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("member-news-phone.png"), fullPage: true });
});

test("a blog post keeps its published byline while its sponsor sidebar uses the shared display", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  await page.route("**/api/v1/sponsors/display?*", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ groups: [], page: { limit: 200, offset: 0, total: 0, hasMore: false } }),
    });
  });
  await page.goto(articlePath);
  await expect(page.getByText("Tomas Gustavsson", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Chief PKI Officer", { exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("post-owned-byline.png"), fullPage: true });
});

test("the event kiosk loads sponsors from the shared bounded D1 endpoint", async ({ page }, testInfo) => {
  const requests: string[] = [];
  await page.route("**/api/v1/sponsors?*", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("eventName")).toBe("Post-Quantum Cryptography Conference Kuala Lumpur 2025");
    expect(url.searchParams.get("minWeight")).toBe("4");
    requests.push(url.href);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sponsors: [
          {
            id: "00000000-0000-4000-8000-000000000008",
            name: "Kiosk verification sponsor",
            website: "https://example.test/",
            logoUrl: "/favicon.svg",
            tier: "Gold",
            eventTier: "Leader",
            effectiveTier: "Leader",
            weight: 4,
          },
        ],
        page: { limit: 200, offset: 0, total: 1, hasMore: false },
      }),
    });
  });
  await page.goto("/events/2025/pqc-conference-kuala-lumpur-my/event-session.html");
  await expect(page.getByRole("img", { name: /Kiosk verification sponsor/ })).toBeVisible();
  expect(requests).toHaveLength(1);
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: /Kiosk verification sponsor/ })
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("kiosk-sponsors.png"), fullPage: true });
});
