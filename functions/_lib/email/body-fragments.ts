import { renderEmailContent } from "./content-blocks";
import type { EmailContentType, EmailTemplateFragment } from "../../../assets/shared/schemas/email-templates";
import { assertTemplateRenderLength, type TemplateRenderBudget } from "./render-limit";

export interface EmailCompilationContext {
  contentType: EmailContentType;
  partial(fragment: EmailTemplateFragment, data: Record<string, unknown>, depth: number): string;
}

type CompileEmailFragment = (
  source: string,
  data: Record<string, unknown>,
  depth: number,
  context: EmailCompilationContext,
) => string;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fragmentKey(nonce: string, index: number): string {
  return `PKICEMAILFRAGMENT${nonce}N${index}X`;
}

/** Render each body independently; only the caller applies the outer email layout. */
export function renderEmailBody(
  source: string,
  data: Record<string, unknown>,
  contentType: EmailContentType,
  budget: TemplateRenderBudget,
  compile: CompileEmailFragment,
  depth = 0,
): string {
  const fragments = new Map<string, string>();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const compiled = compile(source, data, depth, {
    contentType,
    partial(fragment, values, childDepth) {
      const html = renderEmailBody(fragment.content, values, fragment.contentType, budget, compile, childDepth);
      const key = fragmentKey(nonce, fragments.size);
      fragments.set(key, html);
      // A Markdown body keeps its blocks intact, so a shared block stands as its own paragraph.
      return contentType === "markdown" ? `\n\n${key}\n\n` : key;
    },
  });
  if (contentType === "markdown") {
    let html = renderEmailContent(compiled);
    assertTemplateRenderLength(html.length, budget);
    for (const [key, fragment] of fragments) {
      html = html.replace(`<p>${key}</p>`, () => fragment).replace(key, () => fragment);
      assertTemplateRenderLength(html.length, budget);
    }
    return html;
  }
  const pattern = new RegExp(`(PKICEMAILFRAGMENT${nonce}N\\d+X)`, "g");
  const parts: string[] = [];
  let length = 0;
  for (const sourcePart of compiled.split(pattern)) {
    const part =
      fragments.get(sourcePart) ??
      (contentType === "html"
        ? sourcePart
        : sourcePart
          ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(sourcePart)}</pre>`
          : "");
    length += part.length;
    assertTemplateRenderLength(length, budget);
    parts.push(part);
  }
  return parts.join("");
}
