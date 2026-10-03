import { expect, it } from "vitest";
import { renderSiteMarkdown } from "../../site/markdown-processor";

it("renders authored emoji shortcodes in prose and capability tables", async () => {
  const html = await renderSiteMarkdown(
    "## Status :warning:\n\n| Symbol | Meaning |\n| --- | --- |\n| :x: | Unavailable |\n| :heavy_check_mark: | Available |\n| :clock1: | Planned |",
  );
  for (const symbol of ["❌", "✔️", "🕐", "⚠️"]) expect(html).toContain(symbol);
  expect(html).not.toContain(":heavy_check_mark:");
});

it("preserves shortcodes in code, URLs, and unknown names", async () => {
  const html = await renderSiteMarkdown(
    "`:x:`\n\n```text\n:clock1:\n```\n\n[Available :heavy_check_mark:](https://example.com/:x:)\n\n:unknown:",
  );
  expect(html).toContain("<code>:x:</code>");
  expect(html).toContain(":clock1:\n</code>");
  expect(html).toContain('href="https://example.com/:x:"');
  expect(html).toContain("Available ✔️");
  expect(html).toContain(":unknown:");
});

it("supports catalog names and aliases beyond the legacy content", async () => {
  const html = await renderSiteMarkdown(":rocket: :tada: :+1: :thumbsup:");
  expect(html).toContain("🚀");
  expect(html).toContain("🎉");
  expect(html.match(/👍/gu)).toHaveLength(2);
  expect(html).not.toContain("<img");
});

it("preserves published heading anchors, aligned tables, and Mermaid blocks", async () => {
  const html = await renderSiteMarkdown(
    "## Trust  & Keys\n\n## Trust & Keys\n\n| Center | Right |\n| :---: | ---: |\n| A | B |\n| https://example.com/docs||\n\n```mermaid\ngraph TD\nA-->B\n```",
  );
  expect(html).toContain('id="trust--keys"');
  expect(html).toContain('id="trust--keys-1"');
  expect(html).toContain('class="header-link"');
  expect(html).toContain('class="pk-table__scroll pk-table__scroll--prose"');
  expect(html).toContain('class="pk-center"');
  expect(html).toContain('class="pk-end"');
  expect(html).not.toContain("style=");
  expect(html).toContain('href="https://example.com/docs"');
  expect(html).not.toContain("docs||");
  expect(html).toContain('class="mermaid-wrap"');
  expect(html).toContain('<pre class="mermaid">');
});

it("passes authored images to the native image renderer", async () => {
  const html = await renderSiteMarkdown(
    '![Member](/member.svg "Organization")',
    async (src, alt, title) => `<img src="${src}" alt="${alt}" title="${title}" width="120">`,
  );
  expect(html).toContain('<img src="/member.svg" alt="Member" title="Organization" width="120">');
});
