import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { publicEmailImagePublisher } from "../../scripts/publication/publish-email-images.mjs";

describe("email publication images", () => {
  it.each([
    "events/2026/test-conference/",
    "/events/2026/test-conference/",
    "events/2026/test-conference",
    "/events/2026/test-conference",
  ])("publishes stable email images for page path %s", async (pathname) => {
    const output = await mkdtemp(join(tmpdir(), "pkic-email-images-"));
    const route = "/events/2026/test-conference/";
    const directory = join(output, "content-media", route);
    await mkdir(directory, { recursive: true });
    const logo = await sharp({ create: { width: 200, height: 60, channels: 3, background: "#008344" } })
      .jpeg()
      .toBuffer();
    await writeFile(join(directory, "organizational-support.jpg"), logo);
    await writeFile(join(directory, "logo.jpg"), logo);
    await writeFile(
      join(directory, "logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="green"/></svg>',
    );
    await writeFile(
      join(output, "wall.css"),
      ".sponsors {padding:32px;background:white} .sponsors-tier {margin-bottom:24px} img {width:200px;height:60px}",
    );
    const dom = new JSDOM(`<html><head><link rel="stylesheet" href="/wall.css"></head><body>
      <h1>Excluded event content</h1><div class="sponsors"><div class="sponsors-tier">Gold
      <img loading="lazy" src="/content-media${route}logo.jpg"></div>
      <div class="sponsors-tier">Silver<img src="/content-media${route}logo.svg"></div></div>
      </body></html>`);
    const publisher = publicEmailImagePublisher(output);
    try {
      expect(await publisher.publish(dom.window.document, pathname)).toEqual([
        `${route.slice(1)}organizational-support.jpg`,
        `${route.slice(1)}sponsors.jpg`,
      ]);
      expect(await readFile(join(output, route, "organizational-support.jpg"))).toEqual(logo);
      const image = await readFile(join(output, route, "sponsors.jpg"));
      const metadata = await sharp(image).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.width).toBeGreaterThan(2000);
      expect(metadata.height).toBeGreaterThan(200);
      expect(await publisher.publish(dom.window.document, "/members/test/")).toEqual([]);
      dom.window.document.querySelector("img")!.src = "/missing-logo.jpg";
      await expect(publisher.publish(dom.window.document, pathname)).rejects.toThrow();
    } finally {
      await publisher.finish();
      dom.window.close();
      await rm(output, { recursive: true, force: true });
    }
  });
});
