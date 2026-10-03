import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

if (process.env.WORKERS_CI_BRANCH !== "test/astro-cache-reuse" || process.env.CLOUDFLARE_ENV === "production") {
  throw new Error("Cache inspection is restricted to the diagnostic preview branch");
}
const result = spawnSync("pnpm", ["store", "path"], { encoding: "utf8" });
if (result.status !== 0) throw new Error(result.stderr);
const store = result.stdout.trim();
const locations = [
  "node_modules/.astro",
  "node_modules/.cache",
  ".astro",
  ".cache",
  "resources/_gen",
  "public",
  ".next/cache",
  resolve(store, "pkic-publication-cache"),
];
const report = {
  experiment: "repeat-directory-persistence",
  commit: process.env.WORKERS_CI_COMMIT_SHA,
  store,
  locations: {},
};
// Expose only HTTP status and the cache-enabled flag, never API payloads or logs.
report.configuration = { buildStatus: null, triggerStatus: null, cacheEnabled: null };
if (process.env.CLOUDFLARE_API_TOKEN) {
  const base = "https://api.cloudflare.com/client/v4/accounts/dd9c5d7f73f7d170f3e2c1108fc84bb3/builds";
  const options = {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  };
  const response = await fetch(`${base}/builds/2b70a0bf-a907-4c46-b062-5bf8dd9412da`, options);
  report.configuration.buildStatus = response.status;
  if (response.ok) {
    const data = await response.json();
    const trigger = data.result?.build_trigger_metadata?.trigger_uuid;
    if (trigger && /^[a-f0-9-]{36}$/.test(trigger)) {
      const result = await fetch(`${base}/triggers/${trigger}`, options);
      report.configuration.triggerStatus = result.status;
      if (result.ok) {
        const payload = await result.json();
        if (typeof payload.result?.build_caching_enabled === "boolean")
          report.configuration.cacheEnabled = payload.result.build_caching_enabled;
      }
    }
  }
}
for (const location of locations) {
  const entries = await readdir(location).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  const marker = await readFile(resolve(location, "diagnostic-marker.json"), "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  report.locations[location] = { entryCount: entries.length, marker };
  await mkdir(location, { recursive: true });
  await writeFile(resolve(location, "diagnostic-marker.json"), JSON.stringify({ commit: report.commit }));
}
process.env.PKIC_PROBE_CACHE_DIRECTORY = locations[0];
await import("./preview-cache-probe.mjs");
report.nativeImage = JSON.parse(await readFile("dist/cache-probe-assets/cache-probe.json", "utf8"));
await writeFile("dist/client/cache-probe.json", JSON.stringify(report));
