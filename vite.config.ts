import { astroMarkdownWorkerPlugin } from "./scripts/lib/astro-markdown-worker-plugin.mjs";
import { publicationEnvironment, wranglerEnvironment } from "./scripts/publication/build-context.mjs";
import { previewOriginVars } from "./scripts/lib/workers-preview-url.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { contentMediaPlugin } from "./scripts/lib/content-media-plugin.mjs";
import { bylinesPlugin } from "./scripts/lib/bylines-plugin.mjs";
import { trustListPlugin } from "./scripts/lib/trust-list-plugin.mjs";
import { preactAlias, preactEsbuild } from "./scripts/lib/preact-vite.mjs";

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
  // `pnpm dev:test` and `pnpm dev:rehearsal start` hot-reload against their own state
  // directory, whose generated config binds only local resources and captures email.
  const devConfigPath = process.env.PKIC_DEV_WRANGLER_CONFIG;
  const devState = process.env.PKIC_DEV_STATE;
  if (Boolean(devConfigPath) !== Boolean(devState))
    throw new Error("PKIC_DEV_WRANGLER_CONFIG and PKIC_DEV_STATE are set together by scripts/dev-rehearsal.mjs");
  // Vite serves public files itself, before the Worker applies `_headers`, so carry over
  // the portal service worker scope the deployed headers grant to its built scripts.
  const serviceWorkerScope = devState
    ? /^\s*Service-Worker-Allowed:\s*(\S+)/m.exec(readFileSync(resolve(projectRoot, "static/_headers"), "utf8"))?.[1]
    : undefined;

  return {
    clearScreen: false,
    esbuild: preactEsbuild,
    publicDir: resolve(projectRoot, "public"),
    resolve: { alias: preactAlias },
    server: {
      host: "0.0.0.0",
      port: 8788,
      strictPort: true,
      ...(serviceWorkerScope ? { headers: { "Service-Worker-Allowed": serviceWorkerScope } } : {}),
      watch: { ignored: ["**/dist/**", ...(devState ? [`${devState}/**`] : [])] },
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
      cloudflare(
        devConfigPath && devState
          ? {
              configPath: devConfigPath,
              persistState: { path: devState },
              // Serve `_headers` and `_redirects` as the deployed Worker does (portal service worker scope).
              experimental: { headersAndRedirectsDevModeSupport: true },
            }
          : previewVars
            ? { config: { previews: { vars: previewVars } } }
            : {},
      ),
    ],
  };
});
