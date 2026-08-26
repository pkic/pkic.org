import { describe, expect, it } from "vitest";
import { escapeMarkdownText } from "../functions/_lib/email/markdown";
import { renderEmail } from "../functions/_lib/email/render";

const LAYOUT = "<!doctype html><html><body>{{{body_html}}}</body></html>";

describe("untrusted Markdown email text", () => {
  it.each([
    "[review](https://attacker.invalid/link)",
    "![pixel](https://attacker.invalid/pixel.gif)",
    '<img src="https://attacker.invalid/raw.gif">',
    '<a href="https://attacker.invalid/raw">review</a>',
    "[review][target]\n\n[target]: https://attacker.invalid/reference",
    "<https://attacker.invalid/autolink>",
    "https://attacker.invalid/bare",
    "# Heading",
    "Heading\n=======",
    "> Quote",
    "- List item",
  ])("renders %j as literal text without active attacker content", async (input) => {
    const rendered = await renderEmail("{{value}}", { value: escapeMarkdownText(input) }, LAYOUT);

    if (input.includes("attacker.invalid")) expect(rendered.text).toContain("attacker.invalid");
    else expect(rendered.text).not.toHaveLength(0);
    expect(rendered.html).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
    expect(rendered.html).not.toMatch(/<(?:h1|blockquote|ul)\b/i);
  });
});
