import { describe, expect, it } from "vitest";
import { renderModelMarkdown } from "../../site/model-version-html";

describe("external model Markdown publication", () => {
  it("removes executable HTML, event attributes, and unsafe link protocols", async () => {
    const html = await renderModelMarkdown(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[Unsafe](javascript:alert%281%29)\n\n<iframe src="https://example.org"></iframe>\n\n<svg onload="alert(1)"></svg>',
    );
    expect(html).not.toMatch(/<script|<iframe|<svg|onerror|onload|javascript:/i);
  });
  it("retains readable model structure, safe links, and criterion feedback context", async () => {
    const html = await renderModelMarkdown(
      "### Criterion 3.1.5\n\n**Evidence** and [guidance](https://example.org/guidance).\n\n- An assessment check",
    );
    expect(html).toContain('data-content-item-id="3.1.5"');
    expect(html).toContain("<strong>Evidence</strong>");
    expect(html).toContain('aria-label="Criterion 3.1.5"');
    expect(html).toContain('href="#user-content-criterion-315"');
    expect(html).toContain('href="https://example.org/guidance"');
    expect(html).toContain("<li>An assessment check</li>");
  });
});
