import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const branch = "test/astro-cache-reuse";
const local = process.env.PKIC_CACHE_PROBE_LOCAL === "1";
if (!local && process.env.WORKERS_CI_BRANCH !== branch) {
  throw new Error(`Cache probe is restricted to the ${branch} preview branch`);
}
if (process.env.CLOUDFLARE_ENV === "production") throw new Error("Cache probe cannot target production");
process.env.CLOUDFLARE_ENV = "preview";
const cache = resolve(local ? ".cache/probe-local-cache" : "node_modules/.astro");
process.env.PKIC_PROBE_CACHE_DIRECTORY = cache;
const marker = resolve(cache, "preview-cache-probe.json");
let previous;
try {
  previous = JSON.parse(await readFile(marker, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
console.log(
  `[cache-probe] branch=${process.env.WORKERS_CI_BRANCH ?? "local"}; cache=${cache}; restored=${Boolean(previous)}; previous=${JSON.stringify(previous ?? null)}`,
);
const source = resolve(".cache/cache-probe-site");
await mkdir(resolve(source, "src/pages"), { recursive: true });
await sharp({ create: { width: 512, height: 256, channels: 3, background: "#228855" } })
  .png()
  .toFile(resolve(source, "src/fixture.png"));
await writeFile(
  resolve(source, "src/pages/index.astro"),
  `---\nimport {Image} from 'astro:assets';\nimport fixture from '../fixture.png';\n---\n<html lang="en"><head><title>Preview cache probe</title></head><body><h1>Preview cache probe</h1><Image src={fixture} width={128} format="webp" alt="Synthetic cache fixture" /></body></html>\n`,
);
await writeFile(
  resolve(source, "worker.mjs"),
  'export default {fetch(){return new Response("Not found",{status:404})}};\n',
);
await writeFile(
  ".cache/cache-probe-wrangler.json",
  JSON.stringify({
    name: "pkic-org-base",
    account_id: "dd9c5d7f73f7d170f3e2c1108fc84bb3",
    compatibility_date: "2026-03-17",
    main: "cache-probe-site/worker.mjs",
    env: { preview: { name: "pkic-org", assets: { directory: "../dist/cache-probe-assets", binding: "ASSETS" } } },
  }),
);
const started = performance.now();
for (const args of [
  ["exec", "astro", "build", "--config", "scripts/preview-cache-probe.astro.mjs"],
  ["exec", "vite", "build", "--config", "scripts/preview-cache-probe.vite.mjs"],
]) {
  const result = spawnSync("pnpm", args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await mkdir(cache, { recursive: true });
await writeFile(marker, JSON.stringify({ completedAt: new Date().toISOString(), run: (previous?.run ?? 0) + 1 }));
console.log(
  `[cache-probe] complete; restored=${Boolean(previous)}; duration=${(performance.now() - started).toFixed(0)}ms`,
);
