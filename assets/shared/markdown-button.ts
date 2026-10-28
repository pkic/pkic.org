import { Marked } from "marked";
import { markdownMediaInsertSchema } from "./schemas/markdown-editor";

const parser = new Marked();

/** A destination button owns one ordinary Markdown link, never executable action text or raw HTML. */
export function readMarkdownButton(markdown: string): { href: string; label: string; title?: string } {
  const blocks = parser.lexer(markdown).filter((token) => token.type !== "space");
  const block = blocks[0];
  const inline = block?.type === "paragraph" ? block.tokens : [];
  const link = inline?.[0];
  if (
    blocks.length !== 1 ||
    inline?.length !== 1 ||
    link?.type !== "link" ||
    !link.text.trim() ||
    !link.tokens ||
    link.tokens.some((token) => token.type !== "text")
  )
    throw new Error("A button contains one Markdown link with a text label and a safe destination.");
  const label = link.tokens.map((token) => ("text" in token ? token.text : "")).join("");
  const result = markdownMediaInsertSchema.safeParse({ kind: "button", url: link.href, description: label });
  if (!result.success) throw new Error(result.error.issues.map((issue) => issue.message).join(" "));
  return {
    href: result.data.url,
    label: result.data.description,
    title: link.title ?? undefined,
  };
}
