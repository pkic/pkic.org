import { marked, type Token } from "marked";

export type OverlayTemplateValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | OverlayTemplateValue[]
  | {
      readonly [key: string]: OverlayTemplateValue;
    };
type Node =
  | { kind: "text"; value: string }
  | { kind: "value"; value: string }
  | {
      kind: "section";
      value: string;
      inverted: boolean;
      children: Node[];
    };
const MAX_TEMPLATE_LENGTH = 20000;
const MAX_OUTPUT_LENGTH = 100000;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function parse(template: string): Node[] {
  if (template.length > MAX_TEMPLATE_LENGTH) throw new Error("Overlay template is too long");
  const root: Node[] = [];
  const stack = [{ name: "", children: root }];
  let cursor = 0;
  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/gu)) {
    const children = stack.at(-1)!.children;
    children.push({ kind: "text", value: template.slice(cursor, match.index) });
    const tag = match[1].trim();
    const operator = tag[0];
    const name = /^[#^/!]/u.test(operator ?? "") ? tag.slice(1).trim() : tag;
    if (operator === "!") {
      /* Mustache comments do not render. */
    } else {
      if (name !== "." && !/^[a-zA-Z_][\w-]*(?:\.[a-zA-Z_][\w-]*)*$/u.test(name))
        throw new Error("Invalid overlay template tag");
      if (operator === "/") {
        if (stack.length === 1 || stack.at(-1)!.name !== name) throw new Error("Mismatched overlay section");
        stack.pop();
      } else if (operator === "#" || operator === "^") {
        if (stack.length >= 32) throw new Error("Overlay sections are nested too deeply");
        const section: Node = { kind: "section", value: name, inverted: operator === "^", children: [] };
        children.push(section);
        stack.push({ name, children: section.children });
      } else children.push({ kind: "value", value: name });
    }
    cursor = match.index + match[0].length;
  }
  stack.at(-1)!.children.push({ kind: "text", value: template.slice(cursor) });
  if (stack.length !== 1) throw new Error("Unclosed overlay section");
  if (root.some(hasUnmatchedBraces)) throw new Error("Incomplete overlay template tag");
  return root;
}
function hasUnmatchedBraces(node: Node): boolean {
  return node.kind === "section"
    ? node.children.some(hasUnmatchedBraces)
    : node.kind === "text" && /\{\{|\}\}/u.test(node.value);
}

export function validateOverlayTextTemplate(template: string): string | null {
  try {
    parse(template);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid overlay template";
  }
}
/** References for editor affordances; syntax and rendering share this parser. */
export function overlayTextTemplateTags(template: string): string[] {
  const tags: string[] = [];
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.kind !== "text") tags.push(node.value);
      if (node.kind === "section") visit(node.children);
    }
  };
  try {
    visit(parse(template));
  } catch {
    return [];
  }
  return tags;
}
function lookup(name: string, contexts: OverlayTemplateValue[]): OverlayTemplateValue {
  if (name === ".") return contexts.at(-1);
  const keys = name.split(".");
  if (keys.some((key) => BLOCKED_KEYS.has(key))) return undefined;
  for (let index = contexts.length - 1; index >= 0; index--) {
    let value = contexts[index];
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, keys[0])) continue;
    for (const key of keys) {
      if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // Rendering never invokes getters or functions supplied in a context.
      value = descriptor && "value" in descriptor ? descriptor.value : undefined;
    }
    return value;
  }
  return undefined;
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}
function literalMarkdown(value: string | number | boolean): string {
  return String(value).replace(/[\\`*_[\]{}()#+.!|~=<>&-]/gu, "\\$&");
}

/** Template-authored Markdown stays active; interpolated profile/chat data stays literal. */
export function renderOverlayTextMarkdown(template: string, context: OverlayTemplateValue): string {
  const output: string[] = [];
  let length = 0;
  const append = (value: string) => {
    length += value.length;
    if (length > MAX_OUTPUT_LENGTH) throw new Error("Overlay template output is too long");
    output.push(value);
  };
  let visits = 0;
  function render(nodes: Node[], contexts: OverlayTemplateValue[]) {
    for (const node of nodes) {
      if (++visits > 100000) throw new Error("Overlay template expands too many sections");
      if (node.kind === "text") {
        append(node.value);
        continue;
      }
      const value = lookup(node.value, contexts);
      if (node.kind === "value") {
        if (["string", "number", "boolean"].includes(typeof value))
          append(literalMarkdown(value as string | number | boolean));
        continue;
      }
      const truthy = Boolean(value) && !(Array.isArray(value) && value.length === 0);
      if (node.inverted) {
        if (!truthy) render(node.children, contexts);
      } else if (truthy) {
        for (const item of Array.isArray(value) ? value : [value]) render(node.children, [...contexts, item]);
      }
    }
  }
  render(parse(template), [context]);
  return output.join("");
}

/** Only strong/emphasis tags can reach an overlay; links, images and raw HTML cannot. */
export function renderOverlayInlineMarkdown(markdown: string): string {
  if (markdown.length > MAX_OUTPUT_LENGTH) throw new Error("Overlay text is too long");
  function render(tokens: Token[]): string {
    return tokens
      .map((token) => {
        if (token.type === "strong" || token.type === "em")
          return `<${token.type === "strong" ? "strong" : "em"}>${render(token.tokens ?? [])}</${token.type === "strong" ? "strong" : "em"}>`;
        if (token.type === "text" && token.tokens) return render(token.tokens);
        if (token.type === "link" || token.type === "del") return render(token.tokens ?? []);
        if (token.type === "br") return " ";
        if (token.type === "escape" || token.type === "text" || token.type === "codespan")
          return escapeHtml(token.text);
        return escapeHtml(token.raw);
      })
      .join("");
  }
  return render(marked.Lexer.lexInline(markdown, { gfm: false }));
}
export function renderOverlayTextHtml(template: string, context: OverlayTemplateValue): string {
  return renderOverlayInlineMarkdown(renderOverlayTextMarkdown(template, context));
}
