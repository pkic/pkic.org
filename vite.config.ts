import { publicationEnvironment } from "./scripts/publication/build-context.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { contentMediaPlugin } from "./scripts/lib/content-media-plugin.mjs";
import { bylinesPlugin } from "./scripts/lib/bylines-plugin.mjs";
import { trustListPlugin } from "./scripts/lib/trust-list-plugin.mjs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(() => {
  process.env.CLOUDFLARE_ENV = publicationEnvironment();

  const ciBranch = process.env.WORKERS_CI_BRANCH;
  if (ciBranch && ciBranch.toLowerCase() !== "main") {
    const sanitized = ciBranch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const previewUrl = `https://${sanitized}-pkic-org.pkic.workers.dev`;
    process.env.APP_BASE_URL = previewUrl;
    const configFile = resolve(projectRoot, "wrangler.jsonc");
    const content = readFileSync(configFile, "utf8");
    const patched = content.replace(
      /("APP_BASE_URL"\s*:\s*)"https:\/\/[^"]*\.pkic\.workers\.dev\/?"/,
      `$1"${previewUrl}"`,
    );
    if (patched !== content) {
      writeFileSync(configFile, patched);
      console.log(`Preview APP_BASE_URL set to ${previewUrl}`);
    }
  }

  return {
    clearScreen: false,
    esbuild: {
      jsx: "automatic" as const,
      jsxImportSource: "preact",
    },
    publicDir: resolve(projectRoot, "public"),
    resolve: {
      alias: {
        react: "preact/compat",
        "react-dom/test-utils": "preact/test-utils",
        "react-dom": "preact/compat",
        "react/jsx-dev-runtime": "preact/jsx-runtime",
        "react/jsx-runtime": "preact/jsx-runtime",
      },
    },
    server: {
      host: "0.0.0.0",
      port: 8788,
      strictPort: true,
      watch: { ignored: ["**/dist/**"] },
    },
    preview: {
      host: "0.0.0.0",
      port: 8788,
      strictPort: true,
    },
    plugins: [contentMediaPlugin(projectRoot), trustListPlugin(projectRoot), bylinesPlugin(projectRoot), cloudflare()],
  };
});
