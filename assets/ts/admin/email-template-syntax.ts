import { esc } from "./ui";

/** Escapes template source and marks only recognized Handlebars token spans. */
export function highlightTemplateSyntax(source: string): string {
  const out: string[] = [];
  const stack: number[] = [];
  let pos = 0;
  while (pos < source.length) {
    const start = source.indexOf("{{", pos);
    if (start === -1) {
      out.push(esc(source.slice(pos)));
      break;
    }
    if (start > pos) out.push(esc(source.slice(pos, start)));
    const end = source.indexOf("}}", start + 2);
    if (end === -1) {
      out.push(esc(source.slice(start)));
      break;
    }
    const token = source.slice(start, end + 2);
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
    out.push(`<span class="adm-template-token ${className}">${esc(token)}</span>`);
    pos = end + 2;
  }
  return out.join("");
}
