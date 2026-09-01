/**
 * Vite frontend build script.
 *
 * Bundles assets/ts/loader.ts (the single client-side entry point) into
 * static/js/built/ with a content-hashed filename, then writes a minimal
 * manifest to data/asset-manifest.json so Hugo can emit the correct <script>
 * tag.
 *
 * Each dynamic import() in loader.ts becomes a separate lazy chunk with a
 * content-hashed name — only the chunk needed by the current page is fetched.
 *
 * Output goes to static/js/built/ (not public/) so that Hugo's
 * --cleanDestinationDir never deletes the built files; Hugo copies static/
 * into public/ during every build, restoring them automatically.
 *
 * This script is invoked automatically by the Hugo plugin in vite.config.ts
 * before every Hugo build. It can also be run standalone:
 *   node scripts/build-frontend.mjs [--dev]
 */

import { build } from "vite";
import { resolve, relative, dirname } from "node:path";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { assertFrontendBundleBudget } from "./lib/frontend-bundle-budget.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "static", "js", "built");
const dataDir = resolve(root, "data");
const publicBuiltDir = resolve(root, "public", "js", "built");

const entries = {
  loader: resolve(root, "assets/ts/loader.ts"),
};

const isDev = process.argv.includes("--dev");

// Hugo copies static/js/built/ into public/js/built/ on every build, but it
// never deletes files that exist in the destination and not the source —
// so chunks left behind by a previous build (renamed/removed components,
// stale content hashes) accumulate in public/ forever. Vite's own
// `emptyOutDir` only clears static/js/built/, not Hugo's copy of it.
// Clearing public/js/built/ before this build runs (and therefore before
// Hugo's next copy) guarantees Hugo repopulates it as an exact mirror of
// the fresh static/js/built/ output instead of layering on top of stale
// files. This runs unconditionally: it's a no-op on first run (directory
// doesn't exist yet) and production builds already get an equivalent
// clean via Hugo's `--cleanDestinationDir`.
rmSync(publicBuiltDir, { recursive: true, force: true });

/** @type {import('vite').UserConfig} */
const config = {
  root,
  configFile: false,
  // Disable public directory copying — this script writes to static/, not public/.
  publicDir: false,
  // base must match the public URL prefix so chunk imports resolve correctly.
  // Without this, dynamic imports reference /chunks/... instead of /js/built/chunks/...
  base: "/js/built/",
  resolve: {
    // Redirect React imports to Preact's compatibility layer so that
    // React-peer-dependent libraries (e.g. wouter) use Preact instead.
    alias: {
      react: "preact/compat",
      "react-dom/test-utils": "preact/test-utils",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  esbuild: {
    // Use Preact's JSX runtime for all .tsx files.
    jsxImportSource: "preact",
    jsx: "automatic",
  },
  build: {
    outDir,
    emptyOutDir: true,
    minify: !isDev,
    sourcemap: isDev ? "inline" : false,
    rollupOptions: {
      input: entries,
      output: {
        entryFileNames: isDev ? "[name].js" : "[name].[hash].js",
        chunkFileNames: isDev ? "chunks/[name].js" : "chunks/[name].[hash].js",
        // Stylesheets follow the same rule as the scripts: stable names in a
        // dev build so the served files can be inspected, hashed in
        // production so they can be cached indefinitely.
        assetFileNames: isDev ? "[name][extname]" : "[name].[hash][extname]",
        // Rolldown's automatic chunking groups zod (and the runtime helpers
        // it pulls in) into a shared chunk whenever two or more modules
        // import it, then names that chunk after whichever constituent
        // module happens to sort first — e.g. "urls" after
        // assets/shared/schemas/urls.ts. Naming the group explicitly keeps
        // the output deterministic and self-documenting instead of leaving
        // it to that naming accident.
        //
        // `codeSplitting` is the current rolldown API (this project's Vite
        // 8 bundles rolldown ~1.2, see node_modules/vite/package.json); the
        // Rollup-compatible `manualChunks`/`advancedChunks` options are
        // deprecated aliases for it as of rolldown 1.2.
        codeSplitting: {
          groups: [
            {
              name: "vendor",
              test: /node_modules[\\/]zod[\\/]/,
            },
          ],
        },
      },
    },
    target: "es2022",
  },
  plugins: [manifestPlugin({ entries, dataDir, root, isDev })],
};

await build(config);

// ─── Manifest plugin ──────────────────────────────────────────────────────────

/**
 * Writes data/asset-manifest.json after each successful build.
 * Maps the "loader" entry key to its public URL (/js/built/loader.HASH.js)
 * so Hugo's footer.html can emit the correct hashed <script> tag.
 */
function manifestPlugin({ entries, dataDir, root, isDev }) {
  return {
    name: "pkic-asset-manifest",
    writeBundle(_options, bundle) {
      if (!isDev) {
        const chunks = Object.entries(bundle).flatMap(([fileName, output]) =>
          output.type === "chunk" ? [{ fileName, isEntry: output.isEntry, code: output.code }] : [],
        );
        const budget = assertFrontendBundleBudget(chunks);
        const largest = budget.measurements[0];
        console.log(
          `[bundle-budget] ${budget.measurements.length} chunks pass; largest gzip chunk is ${largest.fileName} (${(largest.gzipBytes / 1024).toFixed(2)} KiB)`,
        );
      }
      const inputToKey = Object.fromEntries(
        Object.entries(entries).map(([key, absPath]) => [absPath.replace(/\\/g, "/"), key]),
      );

      const manifest = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        const facadeModule = chunk.facadeModuleId?.replace(/\\/g, "/");
        if (!facadeModule) continue;
        const key = inputToKey[facadeModule];
        if (!key) continue;
        const url = `/js/built/${fileName}`;

        // CSS imported by the entry is emitted as its own asset rather than
        // injected by script, so Hugo has to link it. Lazy chunks are not
        // recorded here on purpose: Vite injects their stylesheets when the
        // chunk loads, which is what keeps component CSS off pages that never
        // reach that component.
        const entryCss = [...(chunk.viteMetadata?.importedCss ?? [])];
        const cssUrl = entryCss.length > 0 ? `/js/built/${entryCss[0]}` : null;
        if (entryCss.length > 1) {
          console.warn(
            `[build-frontend] entry "${key}" emitted ${entryCss.length} stylesheets; only the first is linked.`,
          );
        }

        if (isDev) {
          manifest[key] = cssUrl ? { url, css: cssUrl } : { url };
        } else {
          const filePath = resolve(outDir, fileName);
          const fileContent = readFileSync(filePath);
          const hash = createHash("sha256").update(fileContent).digest("base64");
          manifest[key] = { url, integrity: `sha256-${hash}` };
          if (cssUrl) {
            const cssContent = readFileSync(resolve(outDir, entryCss[0]));
            const cssHash = createHash("sha256").update(cssContent).digest("base64");
            manifest[key].css = cssUrl;
            manifest[key].cssIntegrity = `sha256-${cssHash}`;
          }
        }
      }

      mkdirSync(dataDir, { recursive: true });
      const outPath = resolve(dataDir, "asset-manifest.json");
      writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`[build-frontend] manifest written → ${relative(root, outPath)}`);
    },
  };
}
