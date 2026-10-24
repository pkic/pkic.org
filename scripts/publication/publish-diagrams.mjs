import { publicationCacheDirectory } from "./build-context.mjs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { diagramTheme } from "../../assets/shared/diagram-theme.ts";
import { launchPublicationBrowser } from "./publication-browser.mjs";
import { externalizeDiagramStyles } from "./diagram-styles.mjs";

// Build-done hooks outlive Astro's Vite module runner. Load build tools through
// Node directly, and only when an uncached diagram needs its browser.
const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve("@mermaid-js/mermaid-cli"));
const rendererVersions = [cliRequire("../package.json").version, cliRequire("mermaid/package.json").version];

/** Render each distinct definition once, with the official Mermaid CLI and a persistent cache. */
export async function publicDiagramPublisher(
  output,
  cacheDirectory = publicationCacheDirectory("publication-diagrams"),
) {
  const cache = resolve(cacheDirectory);
  const directory = resolve(output, "_published/diagrams");
  await Promise.all([mkdir(cache, { recursive: true }), mkdir(directory, { recursive: true })]);
  let browser;
  const files = new Set();
  return {
    async publish(document) {
      let occurrence = 0;
      for (const source of document.querySelectorAll(".mermaid-wrap pre.mermaid")) {
        const definition = source.textContent ?? "";
        const hash = createHash("sha256")
          .update(JSON.stringify([rendererVersions, diagramTheme, definition]))
          .digest("hex");
        const id = `diagram-${hash}-${occurrence++}`;
        const cached = resolve(cache, `${hash}.json`);
        let diagram;
        try {
          diagram = JSON.parse(await readFile(cached, "utf8"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          browser ??= await launchPublicationBrowser();
          const { renderMermaid } = require("@mermaid-js/mermaid-cli");
          const result = await renderMermaid(browser, definition, "svg", {
            svgId: "diagram",
            backgroundColor: "transparent",
            mermaidConfig: diagramTheme,
          });
          diagram = { source: Buffer.from(result.data).toString("utf8") };
          const temporary = `${cached}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, JSON.stringify(diagram));
            await rename(temporary, cached);
          } finally {
            await rm(temporary, { force: true });
          }
        }
        const compiled = externalizeDiagramStyles(diagram.source, id);
        const styleHash = createHash("sha256").update(compiled.css).digest("hex");
        const cssFile = `_published/diagrams/${styleHash}.css`;
        await writeFile(resolve(output, cssFile), compiled.css);
        files.add(cssFile);
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `/${cssFile}`;
        document.head.appendChild(link);
        const rendered = document.createElement("div");
        rendered.className = "mermaid";
        rendered.dataset.renderedDiagram = "true";
        rendered.innerHTML = compiled.svg;
        source.replaceWith(rendered);
      }
    },
    async finish() {
      const active = browser;
      browser = undefined;
      await active?.close();
      return [...files];
    },
  };
}
