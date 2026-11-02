import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";
import { frontendOutputFiles } from "../../scripts/lib/frontend-output-files.mjs";

it("keeps an earlier lazy module graph usable after a development rebuild", async () => {
  const root = await mkdtemp(join(tmpdir(), "pkic-client-rebuild-"));
  const outDir = join(root, "output");
  try {
    await mkdir(outDir);
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(join(root, "entry.js"), 'export const open = () => import("./screen.js");');
    await writeFile(join(root, "portal.js"), "export const ready = true;");
    async function compile(version: number) {
      const name = version === 1 ? "original" : "replacement";
      await writeFile(join(root, "artifact.js"), `export const ${name} = ${version};`);
      await writeFile(
        join(root, "screen.js"),
        `import {${name}} from "./artifact.js"; export const read = () => ${name};`,
      );
      await build({
        configFile: false,
        root,
        logLevel: "silent",
        plugins: [
          {
            name: "fixture-styles",
            buildStart() {
              this.emitFile({
                type: "asset",
                name: "screen.css",
                source: version === 1 ? ".screen{color:red}" : ".screen{color:blue}",
              });
            },
          },
        ],
        build: {
          outDir,
          emptyOutDir: false,
          minify: false,
          modulePreload: false,
          rollupOptions: {
            input: { entry: join(root, "entry.js"), portalPage: join(root, "portal.js") },
            preserveEntrySignatures: "strict",
            output: frontendOutputFiles(true),
          },
        },
      });
    }
    await compile(1);
    expect(await readFile(join(outDir, "chunks/portal-page.js"), "utf8")).toContain("ready");
    const previousEntry = await readFile(join(outDir, "entry.js"), "utf8");
    const previousFiles = await readdir(outDir, { recursive: true });
    // A tab retains this entry in memory while the watcher writes a new build.
    await writeFile(join(outDir, "previous-entry.js"), previousEntry);
    await compile(2);
    const earlier = await import(/* @vite-ignore */ pathToFileURL(join(outDir, "previous-entry.js")).href);
    const current = await import(/* @vite-ignore */ pathToFileURL(join(outDir, "entry.js")).href);
    expect((await earlier.open()).read()).toBe(1);
    expect((await current.open()).read()).toBe(2);
    const files = await readdir(outDir, { recursive: true });
    for (const file of previousFiles) expect(files).toContain(file);
    expect(files.filter((file) => file.endsWith(".css"))).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
