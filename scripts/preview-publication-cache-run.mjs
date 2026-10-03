import { publicationCacheDirectory } from "./publication/build-context.mjs";
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { readdir, writeFile } from "node:fs/promises";

if (process.env.WORKERS_CI_BRANCH !== "test/astro-cache-reuse" || process.env.CLOUDFLARE_ENV === "production") {
  throw new Error("Publication cache measurement is restricted to the diagnostic preview branch");
}
process.env.CLOUDFLARE_ENV = "preview";
const before = {};
const cacheFiles = {};
for (const group of ["assets", "publication-social", "publication-diagrams"]) {
  try {
    cacheFiles[group] = await readdir(publicationCacheDirectory(group));
    before[group] = cacheFiles[group].length;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    before[group] = 0;
    cacheFiles[group] = [];
  }
}
const metrics = { reusedImages: 0, generatedImages: 0, publicationLogs: [] };
const started = performance.now();
const child = spawn("bash", ["scripts/build.sh"], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
let pending = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  pending += chunk.toString();
  let end;
  while ((end = pending.indexOf("\n")) !== -1) {
    const line = stripVTControlCharacters(pending.slice(0, end));
    pending = pending.slice(end + 1);
    if (line.includes("reused cache entry")) metrics.reusedImages++;
    if (line.includes("(before:") && line.includes("after:")) {
      metrics.generatedImages++;
    }
    if (line.includes("[publication]") && metrics.publicationLogs.length < 200) metrics.publicationLogs.push(line);
  }
});
const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", resolveExit);
});
if (exitCode !== 0) process.exit(exitCode ?? 1);
const added = {};
for (const group of Object.keys(cacheFiles)) {
  const previous = new Set(cacheFiles[group]);
  added[group] = (await readdir(publicationCacheDirectory(group))).filter((file) => !previous.has(file)).length;
}
const report = {
  commit: process.env.WORKERS_CI_COMMIT_SHA,
  cacheDirectory: publicationCacheDirectory(),
  buildSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
  cacheEntriesBeforeBuild: before,
  cacheFilesAdded: added,
  ...metrics,
};
await writeFile("dist/client/cache-probe.json", JSON.stringify(report));
console.log(`[cache-probe] full publication measurement: ${JSON.stringify(report)}`);
