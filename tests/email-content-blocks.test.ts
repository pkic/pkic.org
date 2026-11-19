/**
 * The editor's `:::` content blocks render in email as inline-styled tables and boxes that
 * email clients display, with the same colors as the site and cells that stack on phones.
 */
import { describe, expect, it } from "vitest";
import { renderEmailContent } from "../functions/_lib/email/content-blocks";
import { escapeMarkdownText } from "../functions/_lib/email/markdown";
import { inlineEmailComponentStyles } from "../functions/_lib/email/render-components";
import { renderEmail } from "../functions/_lib/email/render";

const layout = "<html><body>{{{body_html}}}</body></html>";

describe("email content blocks", () => {
  it("renders a button as a styled link and keeps the surrounding Markdown", () => {
    const html = renderEmailContent(
      "Before.\n\n:::button\n[Confirm my registration →](https://pkic.org/c?a=1&b=2)\n:::\n\nAfter.",
    );
    expect(html).toContain("<p>Before.</p>");
    expect(html).toContain("<p>After.</p>");
    expect(html).toMatch(
      /<a href="https:\/\/pkic\.org\/c\?a=1&b=2" style="[^"]*background:#198754[^"]*">Confirm my registration →<\/a>/,
    );
    expect(html).not.toContain(":::");
  });

  it("styles each button variant and lays out an actions row", () => {
    const html = renderEmailContent(
      "::::actions\n:::button\n[Accept](https://pkic.org/a)\n:::\n:::button variant=secondary\n[Decline](https://pkic.org/d)\n:::\n::::",
    );
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toMatch(/>Decline<\/a>/);
    expect(html).toMatch(/border:1px solid #d1d5db[^"]*">Decline/);
  });

  it("reads a label with escaped variable text", () => {
    const label = escapeMarkdownText("PKI: Post-Quantum & more");
    const html = renderEmailContent(`:::button\n[Join ${label}](https://pkic.org/j)\n:::`);
    expect(html).toContain(">Join PKI: Post-Quantum &amp; more</a>");
  });

  it("splits columns into stacking cells and keeps a heading with its text", () => {
    const html = renderEmailContent(
      ":::columns count=2\n## First\n\nOne paragraph of text here.\n\n## Second\n\nAnother paragraph of text.\n:::",
    );
    const cells = html.match(/<td class="pk-email-col[^"]*"[^>]*>[\s\S]*?<\/td>/g) ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[0]).toContain("First");
    expect(cells[1]).toContain("<h2>Second</h2>");
    expect(cells[1]).toContain("Another paragraph");
  });

  it("renders cards in rows with their variant and pads the last row", () => {
    const html = renderEmailContent(
      "::::cards count=2 variant=muted\n:::card\n**One**\n:::\n:::card variant=accent\n**Two**\n:::\n:::card\n**Three**\n:::\n::::",
    );
    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(html).toMatch(/pk-email-box"[^>]*background:#f8fafc;"><p><strong>One/);
    expect(html).toMatch(/border-top:3px solid #198754[^>]*><p><strong>Two/);
    expect(html).toContain("pk-email-empty");
  });

  it("renders an aside, a grid and a card's header and footer", () => {
    const html = renderEmailContent(
      ":::aside\nA note.\n:::\n\n::::grid count=2\n:::item\nLeft\n:::\n:::item\nRight\n:::\n::::\n\n:::::cards count=1\n::::card\n:::card-header\nTop\n:::\nBody\n:::card-footer\nBottom\n:::\n::::\n:::::",
    );
    expect(html).toMatch(/background:#f8fafc;"><p>A note\.<\/p>/);
    expect(html.match(/pk-email-col pk-email-box/g)).toHaveLength(2);
    expect(html).toMatch(/margin:0 0 12px;"><p>Top<\/p>/);
    expect(html).toMatch(/padding-top:20px;"><p>Bottom<\/p>/);
  });

  it("renders a malformed block as ordinary Markdown", () => {
    expect(renderEmailContent(":::columns\nNever closed")).toContain("Never closed");
    expect(renderEmailContent(":::button\nNot a link\n:::")).toContain("Not a link");
  });

  it("gives the earlier CTA markup the shared button styles", () => {
    const html = inlineEmailComponentStyles('<div class="cta-navy"><a href="https://pkic.org/s">Sign in</a></div>');
    expect(html).toMatch(/<a href="https:\/\/pkic\.org\/s" style="[^"]*background:#198754/);
  });

  it("places shared blocks and reads cells as separate lines in the text version", async () => {
    const rendered = await renderEmail(
      "{{> greeting}}\n\n:::columns count=2\nLeft side text.\n\nRight side text.\n:::",
      {
        firstName: "Ada",
        _partials: { greeting: { content: "Dear {{firstName}},", contentType: "markdown" } },
      },
      layout,
      "markdown",
    );
    expect(rendered.html).toContain("<p>Dear Ada,</p>");
    expect(rendered.html).not.toContain("PKICEMAIL");
    expect(rendered.text).toMatch(/Left side text\.\n+Right side text\./);
  });
});
