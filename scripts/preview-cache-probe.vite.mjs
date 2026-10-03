import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: resolve("dist/cache-probe-assets"),
  plugins: [cloudflare({ configPath: resolve(".cache/cache-probe-wrangler.json") })],
});
