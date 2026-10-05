import { siteMarkdownProcessor } from "./site/markdown-processor.ts";
import { PUBLICATION_SITE_ORIGIN } from "./site/publication-cache.ts";
import { logPublicationBuildCache } from "./scripts/publication/log-build-cache.mjs";
import {
  publicationSupportsPageCache,
  discardPublicationPageCache,
  validatePublicationPageCache,
  sealPublicationPageCache,
} from "./scripts/publication/validate-page-cache.mjs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { preparePublicationPublicAssets } from "./scripts/publication/prepare-public-assets.mjs";
import { publishAssessmentScripts } from "./scripts/publication/publish-assessment-scripts.mjs";
import {
  publicationStagingDirectory,
  publicationEnvironment,
  publicationCacheDirectory,
  publicationForceRebuild,
} from "./scripts/publication/build-context.mjs";
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
const forcedBuild = publicationForceRebuild();
const incrementalBuild = publicationSupportsPageCache(resolve(root, "site"));

export default defineConfig({
  site: PUBLICATION_SITE_ORIGIN,
  srcDir: "./site",
  publicDir: publicAssets,
  outDir: "./dist/astro",
  cacheDir: publicationCacheDirectory(),
  output: "static",
  experimental: { incrementalBuild },
  compressHTML: true,
  markdown: { processor: siteMarkdownProcessor, syntaxHighlight: false },
  trailingSlash: "always",
  build: { assets: "_assets", inlineStylesheets: "never", concurrency: 1 },
  integrations: [
    preact({ compat: true }),
    sitemap({ filter: (url) => !url.includes("/portal/") && !url.includes("/search/") }),
    {
      name: "pkic-publication-post-processing",
      hooks: {
        "astro:build:start": async () => {
          if (forcedBuild) await discardPublicationPageCache(publicationCacheDirectory());
          else if (incrementalBuild) await validatePublicationPageCache(publicationCacheDirectory());
          if (forcedBuild || !incrementalBuild)
            console.log("[publication] forced repair or middleware requires a complete page render");
          await logPublicationBuildCache("before Astro generation");
          await preparePublicationPublicAssets(resolve(root, "public"), publicAssets);
          await publishAssessmentScripts(publicAssets);
        },
        "astro:build:done": async ({ dir, pages }) => {
          await logPublicationBuildCache("after Astro generation");
          await finishAstroRelease(fileURLToPath(dir), pages);
          if (incrementalBuild) await sealPublicationPageCache(publicationCacheDirectory());
          await logPublicationBuildCache("after post-processing");
        },
      },
    },
  ],
  vite: {
    resolve: {
      // Use the native processor for every authored document and shortcode in
      // Astro. The standalone Worker retains its supported runtime processor.
      alias: [
        { find: /^.*\/site-markdown-processor(?:\.ts)?$/, replacement: resolve(root, "site/markdown-processor.ts") },
      ],
    },
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
