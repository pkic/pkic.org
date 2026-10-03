import { defineConfig } from "astro/config";
import { resolve } from "node:path";

export default defineConfig({
  srcDir: resolve(".cache/cache-probe-site/src"),
  publicDir: resolve(".cache/cache-probe-site/public"),
  outDir: resolve("dist/cache-probe-assets"),
  cacheDir: process.env.PKIC_PROBE_CACHE_DIRECTORY,
  build: { assets: "_assets" },
});
