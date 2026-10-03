import { afterEach, expect, it } from "vitest";
import { h, type JSX } from "preact";
import { Suspense } from "preact/compat";
import { renderToStringAsync } from "preact-render-to-string";
import { SiteImage, configureSiteImages } from "../../assets/ts/site/SiteImage";
import { JSDOM } from "jsdom";

const asset = {
  src: "/_assets/photo.webp",
  srcSet: "/_assets/photo-640.webp 640w, /_assets/photo.webp 1400w",
  avifSrcSet: "/_assets/photo-640.avif 640w, /_assets/photo.avif 1400w",
  width: 1400,
  height: 900,
};
afterEach(() => configureSiteImages());
async function renderImage(props: JSX.ImgHTMLAttributes<HTMLImageElement> & { portrait?: boolean }) {
  const html = await renderToStringAsync(h("div", null, h(Suspense, { fallback: null }, h(SiteImage, props))));
  return html.slice(5, -6).replace(/<!--.*?-->/g, "");
}

it("renders unchanged runtime markup when no Astro resolver is installed", async () => {
  expect(await renderImage({ src: "/photo.png", alt: "Photo" })).toBe('<img src="/photo.png" alt="Photo"/>');
});

it("awaits native attributes and preserves authored crops and accessible text", async () => {
  configureSiteImages(async () => asset);
  const dom = new JSDOM(
    await renderImage({ src: "/photo.png", alt: "Conference", width: 600, height: 260, sizes: "25vw" }),
  );
  try {
    const image = dom.window.document.querySelector("img")!;
    expect([image.width, image.height]).toEqual([600, 260]);
    expect(image.alt).toBe("Conference");
    expect(image.sizes).toBe("25vw");
    expect(image.srcset).toBe(asset.srcSet);
    expect(dom.window.document.querySelector("source")?.getAttribute("srcset")).toBe(asset.avifSrcSet);
  } finally {
    dom.window.close();
  }
});

it("prioritizes heroes and requests the bounded portrait policy", async () => {
  const requests: boolean[] = [];
  configureSiteImages(async (_src, portrait) => {
    requests.push(portrait);
    return asset;
  });
  const portrait = await renderImage({ src: "/photo.png", portrait: true });
  const hero = await renderImage({ src: "/photo.png", class: "pkic-hero-media__image" });
  expect(requests).toEqual([true, false]);
  expect(portrait).toContain('sizes="auto, 96px"');
  expect(hero).toContain('fetchpriority="high"');
  expect(hero).toContain('loading="eager"');
  expect(hero).toContain('sizes="100vw"');
});

it("preserves vectors, animations, and external sources without adding picture markup", async () => {
  configureSiteImages(async (src) => (src.endsWith(".svg") ? { src, width: 400, height: 100 } : null));
  const vector = await renderImage({ src: "/logo.svg" });
  expect(vector).toContain('src="/logo.svg"');
  expect(vector).toContain('width="400"');
  expect(vector).not.toContain("<picture");
  expect(await renderImage({ src: "/animated.gif" })).toBe('<img src="/animated.gif"/>');
});
