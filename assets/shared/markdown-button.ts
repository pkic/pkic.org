import { Marked } from "marked";
import { markdownSafeUrl } from "./markdown-media";
import { markdownMediaInsertSchema } from "./schemas/markdown-editor";

const parser = new Marked();

type MarkdownButtonLink = { href: string; label: string; title?: string };

/** A destination button owns one ordinary Markdown link, never executable action text or raw HTML. */
function readMarkdownButtonLink(markdown: string): MarkdownButtonLink {
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
    // Escaped punctuation, as in a variable value, is literal label text.
    link.tokens.some((token) => token.type !== "text" && token.type !== "escape")
  )
    throw new Error("A button contains one Markdown link with a text label and a safe destination.");
  const label = link.tokens.map((token) => ("text" in token ? token.text : "")).join("");
  return { href: link.href, label, title: link.title ?? undefined };
}

/** An authored button, held to the editor's link rules. */
export function readMarkdownButton(markdown: string): MarkdownButtonLink {
  const link = readMarkdownButtonLink(markdown);
  const result = markdownMediaInsertSchema.safeParse({ kind: "button", url: link.href, description: link.label });
  if (!result.success) throw new Error(result.error.issues.map((issue) => issue.message).join(" "));
  return { href: result.data.url, label: result.data.description, title: link.title };
}

/**
 * A button after its template variables are filled in. Server-made links, such as a signed
 * sign-in link, can exceed the editor's URL length, so only the destination's safety is checked.
 */
export function readFilledMarkdownButton(markdown: string): MarkdownButtonLink {
  const link = readMarkdownButtonLink(markdown);
  if (!markdownSafeUrl(link.href)) throw new Error("A button links to a web, email or phone address.");
  return link;
}
