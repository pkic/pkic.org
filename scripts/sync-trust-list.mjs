/**
 * Refreshes the List of Trust Lists snapshot in `data/ltl.json`.
 *
 * The published site fetched this at build time and rendered it into the page.
 * The migration keeps that shape — the page is static HTML, not a widget that
 * calls GitHub from the reader's browser, which the site's own CSP and
 * GitHub's CORS policy both refuse.
 *
 * The snapshot is committed so a build is reproducible and works offline; this
 * script is what moves it forward when a new release is published.
 *
 *   node scripts/sync-trust-list.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseApi = "https://api.github.com/repos/pkic/ltl/releases/latest";

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

const release = await fetchJson(releaseApi, { accept: "application/vnd.github+json" });
const tag = release.tag_name;
if (!tag) throw new Error("The latest release carries no tag name.");
const asset = (release.assets ?? []).find((candidate) => candidate.name === "ltl.json");
const url = asset?.browser_download_url ?? `https://github.com/pkic/ltl/releases/download/${tag}/ltl.json`;

const publishers = await fetchJson(url);
if (!Array.isArray(publishers)) throw new Error("ltl.json is not a list of publishers.");

const target = resolve(root, "data/ltl.json");
writeFileSync(target, `${JSON.stringify({ publishers, release: tag }, null, 2)}\n`);
console.log(`[sync-trust-list] ${publishers.length} publishers from ${tag} → data/ltl.json`);
