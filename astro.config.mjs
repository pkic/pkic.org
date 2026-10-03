import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { preparePublicationPublicAssets } from "./scripts/publication/prepare-public-assets.mjs";
import { publishAssessmentScripts } from "./scripts/publication/publish-assessment-scripts.mjs";
import { publicationStagingDirectory, publicationEnvironment } from "./scripts/publication/build-context.mjs";
import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";
import { contentMediaPlugin } from "./scripts/lib/content-media-plugin.mjs";
import { bylinesPlugin } from "./scripts/lib/bylines-plugin.mjs";
import { trustListPlugin } from "./scripts/lib/trust-list-plugin.mjs";
import { finishAstroRelease } from "./scripts/publication/finish-astro-release.mjs";
import { fileURLToPath } from "node:url";

process.env.CLOUDFLARE_ENV = publicationEnvironment();
process.env.PKIC_PUBLICATION_BUILD_ID = randomUUID();

const root = fileURLToPath(new URL(".", import.meta.url));
const publicAssets = resolve(publicationStagingDirectory(), "public");

export default defineConfig({
  site: "https://pkic.org",
  srcDir: "./site",
  publicDir: publicAssets,
  outDir: "./dist/astro",
  output: "static",
  compressHTML: true,
  trailingSlash: "always",
  build: { inlineStylesheets: "never" },
  integrations: [
    preact({ compat: true }),
    sitemap({ filter: (url) => !url.includes("/portal/") && !url.includes("/search/") }),
    {
      name: "pkic-publication-search",
      hooks: {
        "astro:build:start": async () => {
          await preparePublicationPublicAssets(resolve(root, "public"), publicAssets);
          await publishAssessmentScripts(publicAssets);
        },
        "astro:build:done": async ({ dir, pages }) => {
          await finishAstroRelease(fileURLToPath(dir), pages);
        },
      },
    },
  ],
  vite: {
    ssr: { external: ["@resvg/resvg-wasm"] },
    plugins: [contentMediaPlugin(root), bylinesPlugin(root), trustListPlugin(root)],
    build: {
      assetsInlineLimit: 0,
      minify: true,
      cssMinify: true,
      // Keep portal and interactive component styles out of unrelated public pages.
      cssCodeSplit: true,
      rolldownOptions: { external: ["/pagefind/pagefind.js", /^@resvg\/resvg-wasm(?:\/|$)/] },
    },
  },
});
