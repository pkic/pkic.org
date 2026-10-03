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

test("a blog post keeps its published byline without browser sponsor requests", async ({ page }, testInfo) => {
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  const response = await page.goto(articlePath);
  expect(response?.status()).toBe(200);
  expect(response!.headers()["x-pkic-publication"]).toContain("static;");
  expect(await response!.text()).toContain("Tomas Gustavsson");
  await expect(page.getByText("Tomas Gustavsson", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Chief PKI Officer", { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("post-owned-byline.png"), fullPage: true });
});
