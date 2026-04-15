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
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "static", "js", "built");
const dataDir = resolve(root, "data");

const entries = {
  loader: resolve(root, "assets/ts/loader.ts"),
};

const isDev = process.argv.includes("--dev");

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
      "react": "preact/compat",
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
      const inputToKey = Object.fromEntries(
        Object.entries(entries).map(([key, absPath]) => [
          absPath.replace(/\\/g, "/"),
          key,
        ]),
      );

      const manifest = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        const facadeModule = chunk.facadeModuleId?.replace(/\\/g, "/");
        if (!facadeModule) continue;
        const key = inputToKey[facadeModule];
        if (!key) continue;
        const url = `/js/built/${fileName}`;
        if (isDev) {
          manifest[key] = { url };
        } else {
          const filePath = resolve(outDir, fileName);
          const fileContent = readFileSync(filePath);
          const hash = createHash("sha256").update(fileContent).digest("base64");
          manifest[key] = { url, integrity: `sha256-${hash}` };
        }
      }

      mkdirSync(dataDir, { recursive: true });
      const outPath = resolve(dataDir, "asset-manifest.json");
      writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`[build-frontend] manifest written → ${relative(root, outPath)}`);
    },
  };
}
