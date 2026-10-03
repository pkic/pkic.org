import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBylines } from "./lib/bylines.mjs";
import { webinarSponsors } from "./lib/webinar-assets.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const sourceDir = resolve(root, "static");
const contentDir = resolve(root, "content");
const publicDir = resolve(root, "public");
const contentMediaDir = resolve(publicDir, "content-media");

function isPortableSource(source) {
  const name = basename(source);
  return !name.startsWith("._") && name !== ".AppleDouble";
}

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(sourceDir, publicDir, { recursive: true, filter: isPortableSource });
cpSync(contentDir, contentMediaDir, {
  recursive: true,
  filter(source) {
    return isPortableSource(source) && extname(source).toLowerCase() !== ".md";
  },
});

/*
 * The images the pages' bylines actually show.
 *
 * `assets/images/` holds every member's logo and every representative's
 * photograph — 46 MB — and the published site put only what a page referenced
 * on the wire. Each byline names its own headshot and organization mark, so
 * only those are copied.
 */
const { images: bylineImages } = buildBylines(root);
for (const sponsor of Object.values(webinarSponsors(root))) {
  if (sponsor.logoSrc) bylineImages.push(sponsor.logoSrc.slice(1));
}
for (const relativePath of bylineImages) {
  const target = resolve(publicDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, "assets", relativePath), target);
}
console.log(`[prepare-public] ${bylineImages.length} byline image(s) published`);

if (!process.argv.includes("--assets-only")) {
  if (process.argv.includes("--dev")) process.argv.push("--client-dev");
  await import("./build-frontend.mjs");
}
