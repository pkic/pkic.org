import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";
import { publicImageOptimizer } from "../../scripts/publication/optimize-public-images.mjs";
import { publishResponsiveImage } from "../../scripts/publication/responsive-images.mjs";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function release() {
  const output = await mkdtemp(resolve(tmpdir(), "pkic-responsive-images-"));
  directories.push(output);
  await mkdir(resolve(output, "photos"));
  await mkdir(resolve(output, "img"));
  await writeFile(
    resolve(output, "img/logo.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100"/></svg>',
  );
  const original = await sharp({ create: { width: 1400, height: 900, channels: 4, background: "green" } })
    .png()
    .toBuffer();
  await writeFile(resolve(output, "photos", "conference.png"), original);
  return { output, original };
}

it("renders large SVG coordinate spaces at bounded density without relaxing raster limits", async () => {
  const { output } = await release();
  const vector = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8890 5080"><rect width="8890" height="5080" fill="green"/></svg>',
  );
  const result = await publishResponsiveImage(vector, output, { maxWidth: 1200, maxHeight: 1200 });
  if (!result) throw new Error("Expected a published vector derivative");
  expect(result.width).toBe(1200);
  expect(result.height).toBeGreaterThan(680);
  expect(result.height).toBeLessThan(690);
  const rendered = await sharp(await readFile(resolve(output, result.src.slice(1)))).metadata();
  expect(rendered.width).toBe(result.width);
  expect(rendered.height).toBe(result.height);

  const raster = await sharp({ create: { width: 100, height: 100, channels: 3, background: "green" } })
    .png()
    .toBuffer();
  await expect(publishResponsiveImage(raster, output, { limitInputPixels: 9999 })).rejects.toThrow("pixel limit");
});

it("publishes AVIF and WebP sizes without enlargement and prioritizes the hero", async () => {
  const { output, original } = await release();
  const dom = new JSDOM('<img class="pkic-hero-media__image" src="/photos/conference.png" alt="Conference">');
  try {
    await publicImageOptimizer(output)(dom.window.document);
    const image = dom.window.document.querySelector("img")!;
    const source = dom.window.document.querySelector("picture > source")!;
    expect(image.alt).toBe("Conference");
    expect(image.getAttribute("fetchpriority")).toBe("high");
    expect(image.getAttribute("loading")).toBe("eager");
    expect(image.sizes).toBe("100vw");
    expect([image.width, image.height]).toEqual([1400, 900]);
    expect(source.getAttribute("type")).toBe("image/avif");
    for (const element of [image, source]) {
      const candidates = element.getAttribute("srcset")!.split(", ");
      expect(candidates.length).toBeGreaterThan(4);
      for (const candidate of candidates) {
        const [url, descriptor] = candidate.split(" ");
        const metadata = await sharp(await readFile(resolve(output, url!.slice(1)))).metadata();
        expect(metadata.width).toBe(Number(descriptor!.slice(0, -1)));
        expect(metadata.width).toBeLessThanOrEqual(1400);
        expect(metadata.format).toBe(element === image ? "webp" : "heif");
        if (element === source) expect(metadata.compression).toBe("av1");
      }
    }
    expect(await readFile(resolve(output, "photos", "conference.png"))).toEqual(original);
  } finally {
    dom.window.close();
  }
});

it("keeps authored crop dimensions, lazy sizing, vector images, and existing picture markup", async () => {
  const { output } = await release();
  const dom = new JSDOM(`
    <img src="/photos/conference.png" width="600" height="260" sizes="(min-width: 48rem) 25vw, 100vw" alt="Card">
    <img src="/img/logo.svg" alt="Vector logo">
    <picture><source type="image/webp"><img src="/photos/conference.png" alt="Authored picture"></picture>
    <img src="https://external.example/photo.png" alt="External">
  `);
  try {
    const optimize = publicImageOptimizer(output);
    await optimize(dom.window.document);
    const image = dom.window.document.querySelector("img")!;
    expect([image.width, image.height]).toEqual([600, 260]);
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.sizes).toBe("(min-width: 48rem) 25vw, 100vw");
    expect(dom.window.document.querySelectorAll("picture")).toHaveLength(2);
    expect(dom.window.document.querySelector('img[alt="Vector logo"]')?.getAttribute("src")).toBe("/img/logo.svg");
    const vector = dom.window.document.querySelector<HTMLImageElement>('img[alt="Vector logo"]')!;
    expect([vector.width, vector.height]).toEqual([400, 100]);
    expect(dom.window.document.querySelector('img[alt="External"]')?.hasAttribute("srcset")).toBe(false);
    await optimize(dom.window.document);
    expect(dom.window.document.querySelectorAll("picture")).toHaveLength(2);
  } finally {
    dom.window.close();
  }
});

it("bounds portrait variants without downgrading a hero that uses the same original", async () => {
  const { output } = await release();
  const dom = new JSDOM(`
    <div class="pk-avatar"><img class="pk-avatar__img" src="/photos/conference.png" alt=""></div>
    <img class="pkic-hero-media__image" src="/photos/conference.png" alt="Hero">
  `);
  try {
    await publicImageOptimizer(output)(dom.window.document);
    const avatar = dom.window.document.querySelector<HTMLImageElement>(".pk-avatar__img")!;
    const hero = dom.window.document.querySelector<HTMLImageElement>(".pkic-hero-media__image")!;
    expect(avatar.width).toBe(384);
    expect(avatar.sizes).toBe("auto, 96px");
    expect(hero.width).toBe(1400);
    expect(hero.sizes).toBe("100vw");
    for (const candidate of avatar.srcset.split(", ")) {
      const [url, width] = candidate.split(" ");
      expect(Number(width!.slice(0, -1))).toBeLessThanOrEqual(384);
      expect((await sharp(await readFile(resolve(output, url!.slice(1)))).metadata()).width).toBeLessThanOrEqual(384);
    }
    expect(avatar.src).not.toBe(hero.src);
  } finally {
    dom.window.close();
  }
});
