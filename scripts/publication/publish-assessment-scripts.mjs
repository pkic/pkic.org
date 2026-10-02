import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { selfAssessmentReleases } from "../../assets/shared/self-assessment-releases.ts";

const MAX_BYTES = 8 * 1024 * 1024;

function verify(bytes, integrity) {
  if (bytes.length > MAX_BYTES || `sha384-${createHash("sha384").update(bytes).digest("base64")}` !== integrity)
    throw new Error("Assessment dependency failed integrity verification");
  return bytes;
}

async function readApprovedAsset(url, integrity, cache, download) {
  const cached = resolve(cache, createHash("sha256").update(integrity).digest("hex"));
  try {
    return verify(await readFile(cached), integrity);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const response = await download(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) throw new Error(`Assessment dependency download failed: ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > MAX_BYTES) throw new Error("Assessment dependency exceeds its download limit");
    chunks.push(chunk);
  }
  const bytes = verify(Buffer.concat(chunks), integrity);
  const temporary = `${cached}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, cached);
  } finally {
    await rm(temporary, { force: true });
  }
  return bytes;
}

/** Publish pinned SDK bytes and their licenses so browsing never depends on GitHub. */
export async function publishAssessmentScripts(output, options = {}) {
  const cache = resolve(options.cache ?? "node_modules/.astro/publication-assessment");
  const download = options.download ?? fetch;
  const releases = options.releases ?? Object.values(selfAssessmentReleases);
  await mkdir(cache, { recursive: true });
  for (const release of releases) {
    for (const [suffix, integrity] of [
      ["", release.integrity],
      [".LICENSE.txt", release.licenseIntegrity],
    ]) {
      const bytes = await readApprovedAsset(`${release.sourceUrl}${suffix}`, integrity, cache, download);
      const target = resolve(output, `.${release.url}${suffix}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
}
