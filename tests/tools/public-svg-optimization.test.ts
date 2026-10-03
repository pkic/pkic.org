import { expect, it } from "vitest";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { optimizePublicSvg, publicInlineSvgOptimizer } from "../../scripts/publication/optimize-public-svg.mjs";

const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" aria-labelledby="name description">
  <!-- Editor comment -->
  <title id="name">Synthetic logo</title>
  <desc id="description">An accessible gradient logo</desc>
  <defs>
    <linearGradient id="brand"><stop offset="0%" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff"/></linearGradient>
  </defs>
  <rect class="logo-mark" id="mark" width="100" height="100" fill="url(#brand)"/>
</svg>`;

it("minimizes SVG while preserving accessible descriptions, IDs, scaling, and rendered pixels", async () => {
  const optimized = optimizePublicSvg(source);
  expect(optimized.length).toBeLessThan(source.length);
  expect(optimized).not.toContain("Editor comment");
  const dom = new JSDOM(optimized);
  try {
    const svg = dom.window.document.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(svg.getAttribute("aria-labelledby")).toBe("name description");
    expect(svg.querySelector("#name")?.textContent).toBe("Synthetic logo");
    expect(svg.querySelector("#description")?.textContent).toBe("An accessible gradient logo");
    expect(svg.querySelector("rect#mark.logo-mark")?.getAttribute("fill")).toBe("url(#brand)");
  } finally {
    dom.window.close();
  }
  for (const width of [96, 320]) {
    const before = await sharp(Buffer.from(source)).resize(width).raw().toBuffer();
    const after = await sharp(Buffer.from(optimized)).resize(width).raw().toBuffer();
    expect(after).toEqual(before);
  }
});

it("optimizes inline SVG without altering surrounding text or repeated references", () => {
  const dom = new JSDOM(`<h2>Working group</h2>${source}<p>Text with <code>  significant spaces  </code>.</p>`);
  try {
    const optimize = publicInlineSvgOptimizer();
    optimize(dom.window.document);
    expect(dom.window.document.querySelector("h2")?.textContent).toBe("Working group");
    expect(dom.window.document.querySelector("code")?.textContent).toBe("  significant spaces  ");
    expect(dom.window.document.querySelector("#brand")).not.toBeNull();
    expect(dom.serialize()).not.toContain("Editor comment");
  } finally {
    dom.window.close();
  }
});
