import { marked } from "marked";
import {
  serializeMarkdownContainer,
  splitMarkdownContainers,
  type MarkdownContainerOptions,
} from "../../../assets/shared/markdown-aside";
import { readFilledMarkdownButton } from "../../../assets/shared/markdown-button";
import {
  contentButtonVariantSchema,
  contentCardVariantSchema,
  type ContentCardVariant,
  type ContentContainer,
} from "../../../assets/shared/schemas/content-layout";
import { renderEmailMarkdown } from "./markdown";
import { EMAIL_BUTTON_STYLES } from "./render-components";

/**
 * Email rendering of the editor's content blocks. Email clients ignore grid, flex and most
 * stylesheets, so each block becomes a presentation table or box with inline styles in the
 * site's colors. The layout's phone rules stack `pk-email-col` cells. Icons, card media, bento
 * spans and column widths are site-only and are left out.
 */

// The layout styles every `.eb td` as a data cell; layout cells reset that inline.
const CELL_RESET =
  "border:0;padding:0;font-size:16px;line-height:1.75;color:#374151;vertical-align:top;text-align:left;";
const TABLE_OPEN =
  '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:24px 0;">';
const CARD_STYLES: Record<ContentCardVariant, string> = {
  default: "padding:20px;border:1px solid #e5e9ef;border-radius:8px;background:#ffffff;",
  muted: "padding:20px;border:1px solid #e5e9ef;border-radius:8px;background:#f8fafc;",
  accent: "padding:20px;border:1px solid #e5e9ef;border-top:3px solid #198754;border-radius:8px;background:#ffffff;",
  plain: "padding:0;border:0;background:transparent;",
};
const ASIDE_STYLE = "margin:24px 0;padding:16px 20px;border:1px solid #e5e9ef;border-radius:8px;background:#f8fafc;";
// Gaps are a share of the width so the cells and their spacers add up to the full row.
const COLUMN_GAP = 4;
const CARD_GAP = 3;
const ROW_GAP = 16;

type Cell = { html: string; style: string };
// Variables are already filled in, so a button may carry a long server-made link.
const FILLED: MarkdownContainerOptions = { readButton: readFilledMarkdownButton };

function blockToken(nonce: string, index: number): string {
  return `PKICEMAILBLOCK${nonce}N${index}X`;
}

/** Markdown with the editor's `:::` blocks; malformed blocks render as ordinary Markdown. */
export function renderEmailContent(markdown: string): string {
  let parts: ReturnType<typeof splitMarkdownContainers>;
  try {
    parts = splitMarkdownContainers(markdown, FILLED);
  } catch {
    return renderEmailMarkdown(markdown);
  }
  if (parts.every((part) => typeof part === "string")) return renderEmailMarkdown(markdown);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const blocks: string[] = [];
  let source = "";
  for (const part of parts) {
    if (typeof part === "string") {
      source += part;
      continue;
    }
    source += `\n\n${blockToken(nonce, blocks.length)}\n\n`;
    blocks.push(renderBlock(part));
  }
  let html = renderEmailMarkdown(source);
  blocks.forEach((block, index) => {
    const token = blockToken(nonce, index);
    html = html.replace(`<p>${token}</p>`, () => block).replace(token, () => block);
  });
  return html;
}

function childBlocks(markdown: string): ContentContainer[] {
  return splitMarkdownContainers(markdown, FILLED).filter((part): part is ContentContainer => typeof part !== "string");
}

function renderBlock(block: ContentContainer): string {
  switch (block.type) {
    case "button":
      return renderButtons([block]);
    case "actions":
      return renderButtons(childBlocks(block.markdown));
    case "aside":
      return `<div class="pk-email-box" style="${ASIDE_STYLE}">${renderEmailContent(block.markdown)}</div>`;
    case "columns":
      return renderColumns(block);
    case "grid":
      return renderCells(
        childBlocks(block.markdown).map((item) => ({ html: renderEmailContent(item.markdown), style: "" })),
        block.count,
        COLUMN_GAP,
      );
    case "cards":
      return renderCells(
        childBlocks(block.markdown).map((card) => renderCard(card, block.variant)),
        block.count,
        CARD_GAP,
      );
    case "card": {
      const card = renderCard(block, undefined);
      return `<div class="pk-email-box" style="margin:24px 0;${card.style}">${card.html}</div>`;
    }
    case "card-header":
      return `<div class="pk-email-box" style="margin:0 0 12px;">${renderEmailContent(block.markdown)}</div>`;
    case "card-footer":
      return `<div class="pk-email-box" style="margin:0;padding-top:20px;">${renderEmailContent(block.markdown)}</div>`;
    case "item":
      return renderEmailContent(block.markdown);
  }
}

/** The button body was validated as one safe link; marked renders and escapes it. */
function renderButtons(buttons: ContentContainer[]): string {
  const links = buttons.map((button) => {
    const html = marked.parseInline(button.markdown.trim(), { gfm: true, async: false });
    const link = /^<a href="([^"]*)"(?: title="([^"]*)")?>([\s\S]*)<\/a>$/.exec(html);
    if (!link) return html;
    const variant = contentButtonVariantSchema.catch("primary").parse(button.variant ?? "primary");
    const title = link[2] === undefined ? "" : ` title="${link[2]}"`;
    return `<div style="display:inline-block;margin:4px 6px;"><a href="${link[1]}"${title} style="${EMAIL_BUTTON_STYLES[variant]}">${link[3]}</a></div>`;
  });
  return `<div style="text-align:center;margin:24px 0;">${links.join("")}</div>`;
}

function renderCard(card: ContentContainer, collectionVariant: ContentContainer["variant"]): Cell {
  const variant = contentCardVariantSchema.catch("default").parse(card.variant ?? collectionVariant ?? "default");
  return { html: renderEmailContent(card.markdown), style: CARD_STYLES[variant] };
}

/** Email is about 580px wide: two columns of the site's narrower widths fit, wider ones do not. */
function columnCount(block: ContentContainer): number {
  if (block.count && block.count !== "auto") return Number(block.count);
  return block.width === "16rem" || block.width === "18rem" ? 2 : 1;
}

/** Flowing columns become cells: whole top-level blocks, balanced by length, headings kept with what follows. */
function renderColumns(block: ContentContainer): string {
  const units = splitMarkdownContainers(block.markdown, FILLED).flatMap((part) =>
    typeof part === "string"
      ? marked
          .lexer(part)
          .filter((token) => token.type !== "space")
          .map((token) => ({ markdown: token.raw.trim(), heading: token.type === "heading" }))
      : [{ markdown: serializeMarkdownContainer(part), heading: false }],
  );
  const count = Math.min(columnCount(block), units.length);
  if (count <= 1) return renderEmailContent(block.markdown);
  const total = units.reduce((sum, unit) => sum + unit.markdown.length, 0);
  let before = 0;
  const groups = units.map((unit) => {
    const group = Math.min(count - 1, Math.floor(((before + unit.markdown.length / 2) / total) * count));
    before += unit.markdown.length;
    return group;
  });
  for (let index = units.length - 2; index >= 0; index -= 1)
    if (units[index]!.heading && groups[index]! < groups[index + 1]!) groups[index] = groups[index + 1]!;
  const cells = [...new Set(groups)].map((group) => ({
    html: renderEmailContent(
      units
        .filter((_unit, index) => groups[index] === group)
        .map((unit) => unit.markdown)
        .join("\n\n"),
    ),
    style: "",
  }));
  return renderCells(cells, String(cells.length) as ContentContainer["count"], COLUMN_GAP);
}

/** Rows of equal-width cells with spacer cells between them; the phone layout stacks them. */
function renderCells(cells: Cell[], requested: ContentContainer["count"], gap: number): string {
  if (!cells.length) return "";
  const count =
    requested && requested !== "auto" ? Math.min(Number(requested), cells.length) : Math.min(2, cells.length);
  if (count === 1)
    return cells
      .map((cell) => `<div class="pk-email-box" style="margin:24px 0;${cell.style}">${cell.html}</div>`)
      .join("");
  const width = Math.floor((100 - gap * (count - 1)) / count);
  const spacer = `<td class="pk-email-gap" width="${gap}%" style="${CELL_RESET}width:${gap}%;font-size:0;line-height:0;">&nbsp;</td>`;
  const rows: string[] = [];
  for (let start = 0; start < cells.length; start += count) {
    const row = cells.slice(start, start + count);
    const tds = Array.from({ length: count }, (_value, index) => {
      const cell = row[index];
      const className = cell ? "pk-email-col pk-email-box" : "pk-email-col pk-email-empty";
      return `<td class="${className}" width="${width}%" valign="top" style="${CELL_RESET}width:${width}%;${cell?.style ?? ""}">${cell?.html ?? ""}</td>`;
    });
    rows.push(`<tr>${tds.join(spacer)}</tr>`);
  }
  const rowGap = `<tr class="pk-email-gap"><td colspan="${count * 2 - 1}" height="${ROW_GAP}" style="${CELL_RESET}height:${ROW_GAP}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  return `${TABLE_OPEN}${rows.join(rowGap)}</table>`;
}
