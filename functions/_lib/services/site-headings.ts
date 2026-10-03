import { Marked, type Tokens } from "marked";

/**
 * Heading ids and their anchor links, as the published site renders them.
 *
 * Hugo gave every heading goldmark's automatic id and hung a link icon off
 * levels two to four (`layouts/_default/_markup/render-heading.html` and
 * `partials/anchor.html`). The migration emitted bare `<h2>`s, which cost the
 * icon and — more than cosmetically — every in-page anchor the content links
 * to: the `#references` jumps in the capability matrix, the section nav's
 * `#wg-focus`, a shared link to a heading.
 */

/** Bootstrap Icons' `link-45deg`, which is the mark the published anchor draws. */
const ANCHOR_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-link-45deg" viewBox="0 0 16 16">\n' +
  '    <path d="M4.715 6.542L3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.001 1.001 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>\n' +
  '    <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 0 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 0 0-4.243-4.243L6.586 4.672z"/>\n' +
  "</svg>";

/**
 * Goldmark's automatic heading id: letters and digits kept as they are but
 * lowercased, spaces turned into hyphens, `-` and `_` preserved, and every
 * other character dropped without leaving a separator behind.
 */
/** The five entities `marked` writes back, so `&amp;` slugs as `&` would. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function headingAnchor(text: string): string {
  const target: string[] = [];
  for (const character of decodeEntities(text).trim()) {
    if (/[\p{L}\p{N}]/u.test(character)) target.push(character.toLowerCase());
    else if (character === "-" || character === "_") target.push(character);
    else if (/\s/u.test(character)) target.push("-");
  }
  return target.join("");
}

/**
 * A Markdown parser for one document.
 *
 * The id counter is per document because goldmark disambiguates a repeated
 * heading within the page it belongs to, so the parser cannot be shared
 * between two pages being rendered at once.
 */
export function createContentMarked(): Marked {
  const used = new Map<string, number>();
  const parser = new Marked();
  parser.use({
    renderer: {
      heading(token: Tokens.Heading) {
        const { depth, tokens } = token;
        const body = this.parser.parseInline(tokens);
        // Goldmark reads the id off the heading's rendered text, so emphasis
        // and links contribute their words but not their markup: a heading
        // written `Session 2:_Trust Architectures_` is `session-2trust-architectures`.
        const base = headingAnchor(body.replace(/<[^>]*>/g, ""));
        const seen = used.get(base) ?? 0;
        used.set(base, seen + 1);
        const anchor = seen === 0 ? base : `${base}-${seen}`;
        const link =
          depth >= 2 && depth <= 4
            ? ` <a class="header-link" href="#${anchor}" aria-label="Link to this section">${ANCHOR_ICON}</a>`
            : "";
        const label = body.replace(/<[^>]*>/g, "").replace(/"/g, "&quot;");
        return `<h${depth} id="${anchor}"${link ? ` aria-label="${label}"` : ""}>${body}${link}</h${depth}>\n`;
      },
    },
  });
  parser.use({
    renderer: {
      /*
       * Tables, drawn by the design system's table component.
       *
       * Goldmark's own output is a bare `<table>`; the published site's
       * `render-table.html` wraps it in a scroll container and names the
       * component, which is what keeps a six-column comparison table inside
       * the article on a 375px phone instead of widening the page. Alignment
       * from the delimiter row becomes a utility class rather than a `style`
       * attribute, which the repository forbids and the CSP would not carry.
       */
      table(token: Tokens.Table) {
        const alignClass = (align: string | null) =>
          align === "center" ? ' class="pk-center"' : align === "right" ? ' class="pk-end"' : "";
        const row = (cells: Tokens.TableCell[], tag: "td" | "th") =>
          `<tr>${cells
            .map(
              (cell, index) =>
                `<${tag}${alignClass(token.align[index] ?? null)}>${this.parser.parseInline(cell.tokens)}</${tag}>`,
            )
            .join("")}</tr>`;
        const head = token.header.length ? `<thead>${row(token.header, "th")}</thead>` : "";
        const body = token.rows.length ? `<tbody>${token.rows.map((cells) => row(cells, "td")).join("")}</tbody>` : "";
        return `<div class="pk-table__scroll pk-table__scroll--prose"><table class="pk-table">${head}${body}</table></div>\n`;
      },
    },
  });
  parser.use({
    renderer: {
      /*
       * Mermaid blocks, left for the client renderer to draw.
       *
       * `render-codeblock-mermaid.html` emitted the diagram source as the text
       * of a `pre.mermaid` inside a scroll wrapper, which is the shape
       * `mermaid-init.js` looks for. Highlighted as a code block instead, the
       * diagram never renders and the page shows its source.
       */
      code(token: Tokens.Code) {
        if ((token.lang ?? "").split(/\s+/)[0] !== "mermaid") return false;
        const source = token.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<div class="mermaid-wrap">\n<pre class="mermaid">\n${source}</pre>\n</div>\n`;
      },
    },
  });
  return parser;
}
