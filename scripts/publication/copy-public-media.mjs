import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import sharp from "sharp";
import { JSDOM } from "jsdom";
import { optimizePublicSvg } from "./optimize-public-svg.mjs";
import { publishResponsiveImage } from "./responsive-images.mjs";

let vectorReady;
async function vectorBytes(bytes) {
  let source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY|<image\b|data:image\//i.test(source)) {
    const error = new Error("Published SVG artwork must be pure vector, without embedded bitmaps or XML entities");
    error.name = "InvalidPublishedVector";
    throw error;
  }
  // Some legacy vector uploads omit the SVG namespace. Browsers accept them
  // inline, but an image document needs the namespace before reconstruction.
  const document = new JSDOM(source, { contentType: "image/svg+xml" });
  try {
    const root = document.window.document.documentElement;
    if (root.localName === "svg" && root.namespaceURI === null) {
      root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      source = new document.window.XMLSerializer().serializeToString(root);
    }
  } finally {
    document.window.close();
  }
  vectorReady ??= readFile(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")).then(initWasm);
  await vectorReady;
  // Reconstruct the SVG tree; never serve executable source bytes from R2.
  const vector = new Resvg(source);
  try {
    return Buffer.from(optimizePublicSvg(vector.toString()));
  } finally {
    vector.free();
  }
}

/** Native R2 binding reads; private object keys never enter public output. */
export async function copyPublicMedia({ snapshot, keys, getObject, output }) {
  let serialized = JSON.stringify(snapshot);
  const images = {};
  const missingLogo = (reference) => {
    console.warn(`[publication] Unusable approved member logo ${reference}; using the missing-logo fallback`);
    serialized = serialized.replaceAll(JSON.stringify(reference), "null");
  };
  for (const [reference, key] of Object.entries(keys)) {
    const object = await getObject(key);
    if (!object) throw new Error("A published image source is missing from R2");
    if (object.size > 25 * 1024 * 1024) throw new Error("A published image exceeds the Static Assets file limit");
    const original = Buffer.from(await object.arrayBuffer());
    if (/<svg\b/i.test(original.toString("utf8"))) {
      let bytes;
      try {
        bytes = await vectorBytes(original);
      } catch (cause) {
        if (/^\/api\/v1\/members\/[^/]+\/logo$/.test(reference) && cause.name === "InvalidPublishedVector") {
          missingLogo(reference);
          continue;
        }
        throw new Error(`Could not publish approved vector image ${reference}`, { cause });
      }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const path = `/_published/media/${hash}.svg`;
      const destination = resolve(output, path.slice(1));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      serialized = serialized.replaceAll(JSON.stringify(reference), JSON.stringify(path));
      continue;
    }
    try {
      await sharp(original, { limitInputPixels: 40_000_000 }).metadata();
    } catch (cause) {
      if (
        /^\/api\/v1\/members\/[^/]+\/logo$/.test(reference) &&
        cause.message === "Input buffer contains unsupported image format"
      ) {
        missingLogo(reference);
        continue;
      }
      throw new Error(`Could not decode approved image ${reference}`, { cause });
    }
    // Generate every size from the original, never from an already lossy derivative.
    let responsive;
    try {
      responsive = await publishResponsiveImage(original, output, {
        maxWidth: 1200,
        maxHeight: 1200,
        preserveAnimation: false,
      });
    } catch (cause) {
      throw new Error(`Could not publish approved image ${reference}`, { cause });
    }
    const bytes = await readFile(resolve(output, responsive.src.slice(1)));
    if (bytes.length > 25 * 1024 * 1024) throw new Error("A published image exceeds the Static Assets file limit");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const path = `/_published/media/${hash}.webp`;
    const destination = resolve(output, path.slice(1));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    images[path] = responsive;
    serialized = serialized.replaceAll(JSON.stringify(reference), JSON.stringify(path));
  }
  // Build-only metadata contains public derivative URLs; source R2 keys are never serialized.
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "responsive-images.json"), JSON.stringify(images));
  const published = JSON.parse(serialized);
  // Profile/directory logos are nullable and render initials. Legacy logo walls
  // require a URL and already use the consortium mark when a logo is missing.
  for (const entry of published.memberWall ?? []) entry.logoUrl ??= "/img/logo.svg";
  return published;
}
