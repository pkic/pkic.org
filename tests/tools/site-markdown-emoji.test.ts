import { expect, it } from "vitest";
import { createContentMarked } from "../../functions/_lib/services/site-headings";

it("renders authored emoji shortcodes in prose and capability tables", async () => {
  const html = await createContentMarked().parse(
    "## Status :warning:\n\n| Symbol | Meaning |\n| --- | --- |\n| :x: | Unavailable |\n| :heavy_check_mark: | Available |\n| :clock1: | Planned |",
  );
  for (const symbol of ["❌", "✔️", "🕐", "⚠️"]) expect(html).toContain(symbol);
  expect(html).not.toContain(":heavy_check_mark:");
});

it("preserves shortcodes in code, URLs, escaped text, and unknown names", async () => {
  const html = await createContentMarked().parse(
    "`:x:`\n\n```text\n:clock1:\n```\n\n[Available :heavy_check_mark:](https://example.com/:x:)\n\n\\:warning: :unknown:",
  );
  expect(html).toContain("<code>:x:</code>");
  expect(html).toContain(":clock1:\n</code>");
  expect(html).toContain('href="https://example.com/:x:"');
  expect(html).toContain("Available ✔️");
  expect(html).toContain(":warning: :unknown:");
});

it("supports catalog names and aliases beyond the legacy content", async () => {
  const html = await createContentMarked().parse(":rocket: :tada: :+1: :thumbsup:");
  expect(html).toContain("🚀");
  expect(html).toContain("🎉");
  expect(html.match(/👍/gu)).toHaveLength(2);
  expect(html).not.toContain("<img");
});
