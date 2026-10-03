import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { diagramTheme } from "../../assets/shared/diagram-theme";
import { publicDiagramPublisher } from "../../scripts/publication/publish-diagrams.mjs";
import { linuxDiagramBrowserOptions } from "../../scripts/publication/diagram-browser.mjs";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { externalizeDiagramStyles } from "../../scripts/publication/diagram-styles.mjs";

it("keeps diagram styling and references while removing all inline CSS and separating IDs", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" aria-labelledby="title" viewBox="0 0 100 50"><title id="title">An accessible diagram</title><style>#shape{fill:red}</style><defs><marker id="arrow"><path d="M0 0L5 5L0 10Z"/></marker></defs><path id="shape" d="M0 0h50" marker-end="url(#arrow)" style="stroke:blue"/><foreignObject width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml" style="color:white">A label</div></foreignObject></svg>';
  const first = externalizeDiagramStyles(source, "first");
  const second = externalizeDiagramStyles(source, "second");
  const document = new JSDOM(first.svg, { contentType: "image/svg+xml" }).window.document;
  expect(document.querySelectorAll("style, [style]")).toHaveLength(0);
  expect(document.querySelector("foreignObject")?.textContent).toBe("A label");
  const marker = document.querySelector("marker")!.id;
  expect(document.querySelector("path[marker-end]")?.getAttribute("marker-end")).toBe(`url(#${marker})`);
  expect(first.css).toContain("fill:red");
  expect(first.css).toContain("stroke:blue");
  expect(first.css).toContain("color:white");
  expect(document.documentElement.getAttribute("aria-labelledby")).toBe("first__title");
  expect(document.getElementById("first__title")?.textContent).toBe("An accessible diagram");
  expect(first.svg).toContain("first__diagram");
  expect(second.svg).not.toContain("first__diagram");
});

it("reuses a persisted diagram across publications without requiring a browser", async () => {
  const root = await mkdtemp(join(tmpdir(), "pkic-diagram-cache-"));
  const cache = join(root, "cache");
  const require = createRequire(import.meta.url);
  const cliRequire = createRequire(require.resolve("@mermaid-js/mermaid-cli"));
  const versions = [cliRequire("../package.json").version, cliRequire("mermaid/package.json").version];
  const definition = "flowchart TD; A-->B";
  const hash = createHash("sha256")
    .update(JSON.stringify([versions, diagramTheme, definition]))
    .digest("hex");
  try {
    await mkdir(cache);
    const cached = join(cache, `${hash}.json`);
    const original = JSON.stringify({
      source:
        '<svg xmlns="http://www.w3.org/2000/svg" id="diagram" viewBox="0 0 100 50"><style>#label{fill:black}</style><text id="label">Cached diagram</text></svg>',
    });
    await writeFile(cached, original);
    const outputs = [];
    for (const build of ["first", "second"]) {
      const output = join(root, build);
      const publisher = await publicDiagramPublisher(output, cache);
      try {
        const document = new JSDOM(
          '<html><head></head><body><div class="mermaid-wrap"><pre class="mermaid"></pre></div></body></html>',
        ).window.document;
        document.querySelector("pre")!.textContent = definition;
        await publisher.publish(document);
        expect(document.querySelector("pre")).toBeNull();
        expect(document.querySelector("svg")?.textContent).toContain("Cached diagram");
        const files = await publisher.finish();
        expect(files).toHaveLength(1);
        outputs.push(await readFile(join(output, files[0]), "utf8"));
      } finally {
        await publisher.finish();
      }
    }
    expect(outputs[0]).toBe(outputs[1]);
    expect(await readFile(cached, "utf8")).toBe(original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("extracts a complete rootless Linux renderer and reuses its versioned runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "pkic-diagram-runtime-"));
  try {
    const first = await linuxDiagramBrowserOptions(root);
    const binary = await readFile(first.executablePath);
    expect(binary.subarray(0, 4).toString()).toBe("\x7fELF");
    expect((await stat(first.executablePath)).mode & 0o100).not.toBe(0);
    const libraries = first.env.LD_LIBRARY_PATH.split(":")[0];
    await expect(readFile(join(libraries, "libnss3.so"))).resolves.toBeInstanceOf(Buffer);
    expect(await readFile(join(first.env.FONTCONFIG_PATH, "fonts.conf"), "utf8")).toContain('prefix="relative"');
    const modified = (await stat(first.executablePath)).mtimeMs;
    const second = await linuxDiagramBrowserOptions(root);
    expect(second.executablePath).toBe(first.executablePath);
    expect((await stat(second.executablePath)).mtimeMs).toBe(modified);
    expect(second.args).not.toContain("--disable-web-security");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
