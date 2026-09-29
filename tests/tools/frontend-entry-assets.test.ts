import { describe, expect, it } from "vitest";
import { entryStylesheets } from "../../scripts/lib/frontend-entry-assets.mjs";

describe("entry stylesheet discovery", () => {
  it("links the base styles behind a production wrapper without loading lazy editor styles", () => {
    const chunk = (imports: string[], css: string[] = [], dynamicImports: string[] = []) => ({
      type: "chunk",
      imports,
      dynamicImports,
      viteMetadata: { importedCss: new Set(css) },
    });
    const bundle = {
      "entry.js": chunk(["wrapper.js"]),
      "wrapper.js": chunk(["base.js"], [], ["editor.js"]),
      "base.js": chunk(["wrapper.js"], ["base.css"]),
      "editor.js": chunk([], ["editor.css"]),
    };
    expect(entryStylesheets("entry.js", bundle)).toEqual(["base.css"]);
  });
  it("deduplicates shared styles and follows dependency order", () => {
    const bundle = {
      "entry.js": {
        type: "chunk",
        imports: ["base.js"],
        viteMetadata: { importedCss: new Set(["base.css", "entry.css"]) },
      },
      "base.js": { type: "chunk", imports: [], viteMetadata: { importedCss: new Set(["base.css"]) } },
    };
    expect(entryStylesheets("entry.js", bundle)).toEqual(["base.css", "entry.css"]);
  });
});
