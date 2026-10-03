import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

if (process.env.WORKERS_CI_BRANCH !== "test/astro-cache-reuse" || process.env.CLOUDFLARE_ENV === "production") {
  throw new Error("Cache inspection is restricted to the diagnostic preview branch");
}
const result = spawnSync("pnpm", ["store", "path"], { encoding: "utf8" });
if (result.status !== 0) throw new Error(result.stderr);
const store = result.stdout.trim();
const locations = ["node_modules/.astro", resolve(store, "pkic-publication-cache")];
const report = { experiment: "repeat-persistence", commit: process.env.WORKERS_CI_COMMIT_SHA, store, locations: {} };
for (const location of locations) {
  const entries = await readdir(location).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  const marker = await readFile(resolve(location, "diagnostic-marker.json"), "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  report.locations[location] = { entries, marker };
  await mkdir(location, { recursive: true });
  await writeFile(resolve(location, "diagnostic-marker.json"), JSON.stringify({ commit: report.commit }));
}
process.env.PKIC_PROBE_CACHE_DIRECTORY = locations[1];
await import("./preview-cache-probe.mjs");
report.nativeImage = JSON.parse(await readFile("dist/cache-probe-assets/cache-probe.json", "utf8"));
await writeFile("dist/client/cache-probe.json", JSON.stringify(report));
