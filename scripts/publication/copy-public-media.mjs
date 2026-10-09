import { publicationCacheDirectory } from "./build-context.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import sharp from "sharp";
import { JSDOM } from "jsdom";
import { publicMediaCache } from "./public-media-cache.mjs";
import { optimizePublicSvg } from "./optimize-public-svg.mjs";

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
export async function copyPublicMedia({
  snapshot,
  keys,
  getObject,
  output,
  cacheDirectory = undefined,
  manifest = /** @type {import("./public-media-cache.mjs").PublicMediaManifest | undefined} */ (undefined),
}) {
  const started = performance.now();
  const revision = createHash("sha256")
    .update(await readFile(resolve("scripts/publication/copy-public-media.mjs")))
    .update(await readFile(resolve("scripts/publication/optimize-public-svg.mjs")))
    .update(await readFile(resolve("pnpm-lock.yaml")))
    .update(JSON.stringify(sharp.versions))
    .update(await readFile(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm")))
    .digest("hex");
  const cache = await publicMediaCache(
    resolve(cacheDirectory ?? publicationCacheDirectory("publication-media", process.env.CLOUDFLARE_ENV ?? "local")),
    revision,
    getObject,
    manifest,
  );
  let serialized = JSON.stringify(snapshot);
  const missingLogo = (reference) => {
    console.warn(`[publication] Unusable approved member logo ${reference}; using the missing-logo fallback`);
    serialized = serialized.replaceAll(JSON.stringify(reference), "null");
  };
  for (const [reference, key] of Object.entries(keys)) {
    const { object, cached, store } = await cache.read(key);
    if (cached) {
      const path = `/_published/media/${cached.filename}`;
      const destination = resolve(output, path.slice(1));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, cached.bytes);
      serialized = serialized.replaceAll(JSON.stringify(reference), JSON.stringify(path));
      continue;
    }
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
      await store(bytes, "svg");
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
    const bytes = await sharp(original, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (bytes.length > 25 * 1024 * 1024) throw new Error("A published image exceeds the Static Assets file limit");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const path = `/_published/media/${hash}.webp`;
    const destination = resolve(output, path.slice(1));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    await store(bytes, "webp");
    serialized = serialized.replaceAll(JSON.stringify(reference), JSON.stringify(path));
  }
  // A credited portrait the person has since replaced or removed is no longer public; show initials.
  serialized = serialized.replace(/(?<!\\)"\/api\/v1\/users\/[^"/\\]+\/headshots\/[^"/\\]+"/g, (reference) => {
    console.warn(`[publication] Credited portrait ${reference} is no longer current; using initials`);
    return "null";
  });
  const published = JSON.parse(serialized);
  // Profile/directory logos are nullable and render initials. Legacy logo walls
  // require a URL and already use the consortium mark when a logo is missing.
  for (const entry of published.memberWall ?? []) entry.logoUrl ??= "/img/logo.svg";
  console.log(
    `[publication] R2 media: ${cache.stats.reused} reused, ${cache.stats.downloaded} downloaded (${(cache.stats.downloadedBytes / 1024 / 1024).toFixed(2)} MiB), ${((performance.now() - started) / 1000).toFixed(2)} s`,
  );
  return published;
}
