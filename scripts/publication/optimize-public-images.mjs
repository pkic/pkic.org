import { readFile } from "node:fs/promises";
import { publishResponsiveImage } from "./responsive-images.mjs";
import { publicImageFile } from "./public-image-source.mjs";
import sharp from "sharp";
import { JSDOM } from "jsdom";

/** A publication compiler pass: standard picture markup, with no browser API or image service. */
export function publicImageOptimizer(output, media = {}) {
  const images = new Map(Object.entries(media).map(([source, image]) => [source, Promise.resolve(image)]));
  const vectorDimensions = new Map();
  return async function optimizeImages(document) {
    for (const image of document.querySelectorAll("img[src]")) {
      const source = image.getAttribute("src");
      const vector = /\.svg(?:[?#]|$)/i.test(source);
      if (vector) {
        const file = publicImageFile(source, output, { allowSvg: true });
        if (!file) continue;
        if (!vectorDimensions.has(file))
          vectorDimensions.set(
            file,
            readFile(file, "utf8").then(async (source) => {
              const dom = new JSDOM(source, { contentType: "image/svg+xml" });
              try {
                const box = dom.window.document.documentElement
                  .getAttribute("viewBox")
                  ?.trim()
                  .split(/[\s,]+/)
                  .map(Number);
                if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0)
                  return { width: box[2], height: box[3] };
                return await sharp(file, { density: 1 }).metadata();
              } finally {
                dom.window.close();
              }
            }),
          );
        const { width, height } = await vectorDimensions.get(file);
        if (width && height) {
          if (!image.hasAttribute("width")) image.setAttribute("width", String(width));
          if (!image.hasAttribute("height")) image.setAttribute("height", String(height));
        }
        continue;
      }
      if (image.closest("picture") || image.hasAttribute("srcset")) continue;
      const file = publicImageFile(source, output);
      if (!file) continue;
      // The largest canonical avatar is 92 CSS pixels; 384 pixels covers dense
      // displays without encoding full-page variants for every portrait.
      const avatar = Boolean(image.closest(".pk-avatar"));
      const maxWidth = avatar ? 384 : 1920;
      const key = JSON.stringify({ source, maxWidth });
      if (!images.has(source) && !images.has(key))
        images.set(
          key,
          readFile(file)
            // Repository photographs are trusted build inputs, including larger camera originals.
            .then((bytes) => publishResponsiveImage(bytes, output, { maxWidth, limitInputPixels: 100_000_000 }))
            .catch((error) => {
              throw new Error(`Cannot publish image ${source}: ${error.message}`, { cause: error });
            }),
        );
      const published = await (images.get(source) ?? images.get(key));
      if (!published) continue;
      const hero = image.classList.contains("pkic-hero-media__image");
      image.setAttribute("decoding", "async");
      if (hero) {
        image.setAttribute("fetchpriority", "high");
        image.setAttribute("loading", "eager");
      } else if (!image.hasAttribute("loading")) image.setAttribute("loading", "lazy");
      const sizes =
        image.getAttribute("sizes") ??
        (hero ? "100vw" : avatar ? "auto, 96px" : "auto, (min-width: 80rem) 76rem, calc(100vw - 2rem)");
      image.setAttribute("sizes", sizes);
      image.setAttribute("src", published.src);
      image.setAttribute("srcset", published.formats.webp.map(({ src, width }) => `${src} ${width}w`).join(", "));
      if (!image.hasAttribute("width")) image.setAttribute("width", String(published.width));
      if (!image.hasAttribute("height")) image.setAttribute("height", String(published.height));
      const picture = document.createElement("picture");
      picture.className = "pkic-responsive-picture";
      const avif = document.createElement("source");
      avif.type = "image/avif";
      avif.setAttribute("sizes", sizes);
      avif.setAttribute("srcset", published.formats.avif.map(({ src, width }) => `${src} ${width}w`).join(", "));
      image.replaceWith(picture);
      picture.append(avif, image);
    }
  };
}
