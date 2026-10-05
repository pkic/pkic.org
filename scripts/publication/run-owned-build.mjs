import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

// This opt-in command never activates a Worker version. It requires explicitly
// approved CI ownership/configuration and the authenticated native D1 bindings.
const output = resolve(".cache/publication-machine/runner.mjs");
await mkdir(resolve(".cache/publication-machine"), { recursive: true });
await build({
  configFile: false,
  build: {
    ssr: resolve("scripts/publication/machine-build.ts"),
    outDir: resolve(".cache/publication-machine"),
    emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: "runner.mjs", format: "es" } },
  },
});
const { runOwnedPublicationBuild } = await import(pathToFileURL(output).href);
await runOwnedPublicationBuild();
