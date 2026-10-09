import { astroMarkdownWorkerPlugin } from "./scripts/lib/astro-markdown-worker-plugin.mjs";
import { publicationEnvironment, wranglerEnvironment } from "./scripts/publication/build-context.mjs";
import { previewOriginVars } from "./scripts/lib/workers-preview-url.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { contentMediaPlugin } from "./scripts/lib/content-media-plugin.mjs";
import { bylinesPlugin } from "./scripts/lib/bylines-plugin.mjs";
import { trustListPlugin } from "./scripts/lib/trust-list-plugin.mjs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(() => {
  // The Cloudflare plugin selects the Wrangler environment. A preview build
  // emits the production Worker config, whose previews block binds preview resources.
  // Vite evaluates this config more than once, so pin the publication target
  // before CLOUDFLARE_ENV is rewritten to the Wrangler environment.
  const target = process.env.PKIC_PUBLICATION_TARGET ?? publicationEnvironment();
  process.env.PKIC_PUBLICATION_TARGET = target;
  process.env.CLOUDFLARE_ENV = wranglerEnvironment(target);

  // Each Preview's links and passkey origin come from its own branch URL.
  // Only previews.vars changes; production and local builds inject nothing.
  const previewVars = target === "preview" ? previewOriginVars() : null;
  if (previewVars) console.log(`Preview origin set to ${previewVars.APP_BASE_URL}`);

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
    plugins: [
      astroMarkdownWorkerPlugin(),
      contentMediaPlugin(projectRoot),
      trustListPlugin(projectRoot),
      bylinesPlugin(projectRoot),
      cloudflare(previewVars ? { config: { previews: { vars: previewVars } } } : {}),
    ],
  };
});
