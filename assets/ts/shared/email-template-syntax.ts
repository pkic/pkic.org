function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface TemplateSyntaxSpan {
  from: number;
  to: number;
  className: string;
}

/** Shared token ranges for source and visual editor highlighting. */
export function templateSyntaxSpans(source: string): TemplateSyntaxSpan[] {
  const out: TemplateSyntaxSpan[] = [];
  const stack: number[] = [];
  let pos = 0;
  while (pos < source.length) {
    const start = source.indexOf("{{", pos);
    if (start === -1) {
      break;
    }
    const end = source.indexOf("}}", start + 2);
    if (end === -1) {
      break;
    }
    const inner = source.slice(start + 2, end).trim();
    let className = "adm-template-token-var";
    if (inner.startsWith("#")) {
      const depth = stack.length % 8;
      stack.push(depth);
      className = `adm-template-token-depth-${depth}`;
    } else if (inner.startsWith("/")) {
      className = `adm-template-token-depth-${(stack.length > 0 ? stack.pop()! : 0) % 8}`;
    } else if (inner === "else") {
      className = `adm-template-token-depth-${(stack.length > 0 ? stack[stack.length - 1] : 0) % 8}`;
    }
    out.push({ from: start, to: end + 2, className });
    pos = end + 2;
  }
  return out;
}

/** Escapes template source and marks only recognized Handlebars token spans. */
export function highlightTemplateSyntax(source: string): string {
  let from = 0;
  const out = templateSyntaxSpans(source).map((span) => {
    const html = `${esc(source.slice(from, span.from))}<span class="adm-template-token ${span.className}">${esc(source.slice(span.from, span.to))}</span>`;
    from = span.to;
    return html;
  });
  return out.join("") + esc(source.slice(from));
}
