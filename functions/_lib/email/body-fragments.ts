import { renderEmailMarkdown } from "./markdown";
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
      const key = `PKIC_EMAIL_FRAGMENT_${nonce}_${fragments.size}`;
      fragments.set(key, html);
      return key;
    },
  });
  const pattern = new RegExp(`(PKIC_EMAIL_FRAGMENT_${nonce}_\\d+)`, "g");
  const parts: string[] = [];
  let length = 0;
  for (const sourcePart of compiled.split(pattern)) {
    const fragment = fragments.get(sourcePart);
    const part =
      fragment ??
      (contentType === "markdown"
        ? renderEmailMarkdown(sourcePart)
        : contentType === "html"
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
