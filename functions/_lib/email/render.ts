import { marked } from "marked";
import type { EmailContentType } from "../../../assets/shared/schemas/email-templates";
import { resolveEmailTemplateData } from "./plain-text";
import {
  assertEmailTemplateRenderLength,
  EMAIL_TEMPLATE_RENDER_MAX_CHARS,
  throwEmailTemplateRenderLimitExceeded,
} from "./render-limit";

export { EMAIL_TEMPLATE_RENDER_MAX_CHARS } from "./render-limit";

export const EMAIL_TEMPLATE_RENDER_MAX_EXPANSIONS = 1_000;
export const EMAIL_TEMPLATE_RENDER_MAX_WORK_CHARS = 8_000_000;
export const EMAIL_SUBJECT_RENDER_MAX_CHARS = 8_192;
const EMAIL_TEMPLATE_RENDER_MAX_DEPTH = 32;

interface TemplateRenderBudget {
  maxChars: number;
  maxExpansions: number;
  maxWorkChars: number;
  expansions: number;
  workChars: number;
}

function createTemplateRenderBudget(
  maxChars = EMAIL_TEMPLATE_RENDER_MAX_CHARS,
  maxExpansions = EMAIL_TEMPLATE_RENDER_MAX_EXPANSIONS,
  maxWorkChars = EMAIL_TEMPLATE_RENDER_MAX_WORK_CHARS,
): TemplateRenderBudget {
  return { maxChars, maxExpansions, maxWorkChars, expansions: 0, workChars: 0 };
}

function throwTemplateRenderLimitExceeded(): never {
  return throwEmailTemplateRenderLimitExceeded();
}

function assertTemplateRenderLength(length: number, budget: TemplateRenderBudget): void {
  assertEmailTemplateRenderLength(length, budget.maxChars);
}

function assertTemplateRenderDepth(depth: number): void {
  if (depth > EMAIL_TEMPLATE_RENDER_MAX_DEPTH) throwTemplateRenderLimitExceeded();
}

function consumeTemplateExpansions(budget: TemplateRenderBudget, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || budget.expansions + count > budget.maxExpansions) {
    throwTemplateRenderLimitExceeded();
  }
  budget.expansions += count;
}

function consumeTemplateWork(budget: TemplateRenderBudget, characters: number): void {
  if (!Number.isSafeInteger(characters) || characters < 0 || budget.workChars + characters > budget.maxWorkChars) {
    throwTemplateRenderLimitExceeded();
  }
  budget.workChars += characters;
}

function replaceTemplateBounded(
  input: string,
  pattern: RegExp,
  replacement: (match: RegExpExecArray) => string,
  budget: TemplateRenderBudget,
): string {
  if (!pattern.global) throw new Error("Bounded template replacement requires a global expression");
  pattern.lastIndex = 0;
  const parts: string[] = [];
  let outputLength = 0;
  let inputOffset = 0;
  let match: RegExpExecArray | null;

  const append = (value: string): void => {
    outputLength += value.length;
    assertTemplateRenderLength(outputLength, budget);
    parts.push(value);
  };

  while ((match = pattern.exec(input)) !== null) {
    append(input.slice(inputOffset, match.index));
    append(replacement(match));
    inputOffset = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex++;
  }
  append(input.slice(inputOffset));
  return parts.join("");
}

// ─── Conditional template helpers ────────────────────────────────────────────

function isTruthy(value: unknown): boolean {
  return Boolean(value) && value !== "false" && value !== "0" && value !== "";
}

function evaluateIfCondition(condition: string, data: Record<string, unknown>): boolean {
  // {{#if and var1 var2 ...}}
  if (condition.startsWith("and ")) {
    return condition
      .slice(4)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((c) => isTruthy(data[c]));
  }
  // {{#if or var1 var2 ...}}
  if (condition.startsWith("or ")) {
    return condition
      .slice(3)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .some((c) => isTruthy(data[c]));
  }
  // {{#if eq|ne|gt|gte|lt|lte var "literal"}}
  const cmpMatch = /^(eq|ne|gt|gte|lt|lte)\s+(\w+)\s+"([^"]*)"$/.exec(condition);
  if (cmpMatch) {
    const [, op, variable, literal] = cmpMatch;
    const value = String(data[variable] ?? "");
    const n = parseFloat(value),
      nl = parseFloat(literal);
    switch (op) {
      case "eq":
        return value === literal;
      case "ne":
        return value !== literal;
      case "gt":
        return !isNaN(n) && !isNaN(nl) && n > nl;
      case "gte":
        return !isNaN(n) && !isNaN(nl) && n >= nl;
      case "lt":
        return !isNaN(n) && !isNaN(nl) && n < nl;
      case "lte":
        return !isNaN(n) && !isNaN(nl) && n <= nl;
    }
  }
  // {{#if var}} — truthy check
  return isTruthy(data[condition]);
}

/**
 * Finds the position of the close tag that matches the already-open block,
 * counting nesting depth so inner same-type blocks don't confuse it.
 * `searchFrom` is the position immediately after the opening tag's `}}`.
 * Returns -1 if no matching close tag is found.
 */
function findMatchingCloseTag(
  template: string,
  searchFrom: number,
  openPrefix: string, // e.g., "{{#if "  — increments depth
  closeTag: string, // e.g., "{{/if}}" — decrements depth
): number {
  let depth = 1;
  let pos = searchFrom;
  while (pos < template.length) {
    const nextOpen = template.indexOf(openPrefix, pos);
    const nextClose = template.indexOf(closeTag, pos);
    if (nextClose === -1) return -1; // unmatched open
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      // Skip past this inner opening tag's closing "}}"
      const innerClose = template.indexOf("}}", nextOpen + openPrefix.length);
      pos = innerClose !== -1 ? innerClose + 2 : nextOpen + openPrefix.length;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + closeTag.length;
    }
  }
  return -1;
}

/**
 * Finds the position of `{{else}}` at nesting depth 0 within `content`
 * (i.e., not inside a nested {{#if}} / {{#unless}} block).
 * Returns -1 if not found.
 */
function findElseAtDepth0(content: string, openPrefix: string, closeTag: string): number {
  let depth = 0;
  let pos = 0;
  while (pos < content.length) {
    const nextOpen = content.indexOf(openPrefix, pos);
    const nextClose = content.indexOf(closeTag, pos);
    const nextElse = content.indexOf("{{else}}", pos);

    const openAt = nextOpen !== -1 ? nextOpen : Infinity;
    const closeAt = nextClose !== -1 ? nextClose : Infinity;
    const elseAt = nextElse !== -1 ? nextElse : Infinity;

    const earliest = Math.min(openAt, closeAt, elseAt);
    if (!isFinite(earliest)) break;

    if (elseAt === earliest && depth === 0) return nextElse;
    if (openAt === earliest) {
      depth++;
      const innerClose = content.indexOf("}}", nextOpen + openPrefix.length);
      pos = innerClose !== -1 ? innerClose + 2 : nextOpen + openPrefix.length;
    } else if (closeAt === earliest) {
      depth--;
      pos = nextClose + closeTag.length;
    } else {
      // elseAt === earliest, depth > 0: nested {{else}} inside an inner block — skip over it.
      pos = nextElse + 8;
    }
  }
  return -1;
}

/**
 * Recursively resolves all {{#if}} / {{#unless}} / {{else}} / {{/if}} / {{/unless}}
 * blocks in `template` using a depth-counting scanner rather than regex.
 * This correctly handles arbitrary nesting without ambiguity.
 */
function resolveAllConditionals(
  template: string,
  data: Record<string, unknown>,
  budget: TemplateRenderBudget,
  depth: number,
): string {
  assertTemplateRenderDepth(depth);
  consumeTemplateWork(budget, template.length);
  let result = "";
  let pos = 0;

  const append = (value: string): void => {
    assertTemplateRenderLength(result.length + value.length, budget);
    result += value;
  };

  while (pos < template.length) {
    const ifIdx = template.indexOf("{{#if ", pos);
    const unlessIdx = template.indexOf("{{#unless ", pos);

    // No more conditional tags — append remainder and stop.
    if (ifIdx === -1 && unlessIdx === -1) {
      append(template.slice(pos));
      break;
    }

    const isUnless = unlessIdx !== -1 && (ifIdx === -1 || unlessIdx < ifIdx);
    const tagIdx = isUnless ? unlessIdx : ifIdx;
    const openPfx = isUnless ? "{{#unless " : "{{#if ";
    const closeTag = isUnless ? "{{/unless}}" : "{{/if}}";

    // Append literal text before this tag.
    append(template.slice(pos, tagIdx));

    // Find the end of the opening tag.
    const condEnd = template.indexOf("}}", tagIdx + openPfx.length);
    if (condEnd === -1) {
      // Malformed — emit as-is and stop.
      append(template.slice(tagIdx));
      break;
    }

    const condition = template.slice(tagIdx + openPfx.length, condEnd).trim();
    const openTagEnd = condEnd + 2;

    // Find the matching close tag (depth-aware).
    const closeAt = findMatchingCloseTag(template, openTagEnd, openPfx, closeTag);
    if (closeAt === -1) {
      // Unmatched tag — emit the opening tag text and keep scanning.
      append(template.slice(tagIdx, openTagEnd));
      pos = openTagEnd;
      continue;
    }

    const blockContent = template.slice(openTagEnd, closeAt);
    const afterBlock = closeAt + closeTag.length;

    // Find {{else}} at depth 0 within the block.
    const elseAt = findElseAtDepth0(blockContent, openPfx, closeTag);
    const ifContent = elseAt !== -1 ? blockContent.slice(0, elseAt) : blockContent;
    const elseContent = elseAt !== -1 ? blockContent.slice(elseAt + "{{else}}".length) : "";

    // Evaluate and recursively process the chosen branch.
    const isTrue = isUnless ? !isTruthy(data[condition]) : evaluateIfCondition(condition, data);
    append(resolveAllConditionals(isTrue ? ifContent : elseContent, data, budget, depth + 1));

    pos = afterBlock;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple template engine for email — Handlebars-inspired syntax with Cloudflare Workers compatibility.
 *
 * SUPPORTED SYNTAX:
 *
 * 1. Variables:
 *    {{variable}}
 *
 * 2. Loops (standard Handlebars {{#each}}):
 *    {{#each arrayVariable}}
 *      Item: {{this}} or {{.}}
 *      Index: {{@index}} (0-based)
 *      First: {{@first}} (true/false)
 *      Last: {{@last}} (true/false)
 *    {{/each}}
 *
 * 3. Conditionals (truthy check):
 *    {{#if variable}}
 *      content
 *    {{else}}
 *      fallback
 *    {{/if}}
 *    {{#unless variable}}content{{/unless}}
 *
 * 4. Comparisons (non-standard, PKI Consortium extension):
 *    {{#if eq variable "literal"}}...{{/if}}
 *    {{#if ne variable "literal"}}...{{/if}}
 *    {{#if gt variable "5"}}...{{/if}}
 *    {{#if gte variable "5"}}...{{/if}}
 *    {{#if lt variable "5"}}...{{/if}}
 *    {{#if lte variable "5"}}...{{/if}}
 *
 *    Supported operators: eq, ne, gt, gte, lt, lte
 *    Numeric comparisons (gt, gte, lt, lte) parse as floats.
 *
 * 5. Logical operators (PKI Consortium extension):
 *    {{#if and var1 var2 var3}}all truthy{{/if}}
 *    {{#if or var1 var2 var3}}at least one truthy{{/if}}
 *    {{#if and var1 (ne status "cancelled")}}complex condition{{/if}}
 *
 *    Note: 'and'/'or' cannot nest. Use simple variables or single comparisons.
 *
 * 6. Partials (PKI Consortium extension):
 *    {{> partial_name}}
 *
 *    Partials are resolved from data._partials (Record<string,string>). Each partial
 *    is compiled with the same data variables, but cannot itself include other partials
 *    (1-level deep only). Unknown partials render as empty string.
 *    Load partials from DB via loadEmailPartials() and inject as data._partials.
 *
 * LIMITATIONS:
 * - Nested conditionals are supported; nested loops are not
 * - No custom Handlebars helpers
 * - Comparison/logical operators are lowercase only: {{#if EQ ...}} fails
 * - {{#for}} and {{#each array as |item|}} are NOT supported; use {{#each array}}
 * - Partials are 1-level deep only; nested {{> ...}} inside a partial are stripped
 *
 * WHY CUSTOM:
 * Cloudflare Workers blocks Handlebars.compile() because it uses eval/new Function().
 * This engine trades Handlebars' full feature set for CSP compliance.
 */
function compileSimpleTemplateWithBudget(
  template: string,
  data: Record<string, unknown>,
  budget: TemplateRenderBudget,
  depth: number,
): string {
  assertTemplateRenderDepth(depth);
  assertTemplateRenderLength(template.length, budget);
  consumeTemplateWork(budget, template.length);
  let result = template;

  // ────────────────────────────────────────────────────────────────────────────
  // 0. PARTIALS: {{> name}}
  //    Resolved from data._partials. Compiled with the same data (minus _partials
  //    so the recursive call cannot itself process further partials — 1-level only).
  // ────────────────────────────────────────────────────────────────────────────
  {
    const partials = (data._partials ?? {}) as Record<string, string>;
    if (Object.keys(partials).length > 0) {
      const dataForPartial = { ...data };
      delete dataForPartial._partials;
      result = replaceTemplateBounded(
        result,
        /\{\{>\s*(\w+)\s*\}\}/g,
        (match) => {
          const name = match[1];
          const partialContent = partials[name];
          if (partialContent === undefined) return "";
          consumeTemplateExpansions(budget, 1);
          // Compile the partial — recursive call has no _partials, blocking further nesting.
          return compileSimpleTemplateWithBudget(partialContent, dataForPartial, budget, depth + 1);
        },
        budget,
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 1. LOOPS: {{#each array}}...{{/each}}
  //    Processes nested conditionals inside loop content.
  // ────────────────────────────────────────────────────────────────────────────
  result = replaceTemplateBounded(
    result,
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (match) => {
      const array = data[match[1]];
      if (!Array.isArray(array)) {
        return ""; // Not an array, skip loop
      }

      consumeTemplateExpansions(budget, array.length);
      const expanded: string[] = [];
      let expandedLength = 0;
      for (const [index, item] of array.entries()) {
        let loopContent = match[2];

        // Create a temporary data object with loop variables + item properties
        const loopData = { ...data };
        loopData["this"] = item;
        loopData["."] = item;
        loopData["@index"] = index;
        loopData["@first"] = index === 0;
        loopData["@last"] = index === array.length - 1;

        // If item is an object, merge its properties into loopData
        if (item !== null && typeof item === "object" && !(item instanceof Array)) {
          Object.assign(loopData, item);
        }

        // Recursively process the loop content (handles nested conditionals)
        loopContent = compileSimpleTemplateWithBudget(loopContent, loopData, budget, depth + 1);
        expandedLength += loopContent.length;
        assertTemplateRenderLength(expandedLength, budget);
        expanded.push(loopContent);
      }
      return expanded.join("");
    },
    budget,
  );

  // ────────────────────────────────────────────────────────────────────────────
  // 2–4. CONDITIONALS — depth-counting scanner (handles arbitrary nesting)
  //
  //   Delegates to resolveAllConditionals() which walks the template string
  //   once, using findMatchingCloseTag() to correctly pair every {{#if}} with
  //   its own {{/if}} regardless of how deeply nested the blocks are.
  //   Supports all forms: {{#if var}}, {{#if eq}}, {{#if and/or}}, {{#unless}}.
  // ────────────────────────────────────────────────────────────────────────────
  result = resolveAllConditionals(result, data, budget, depth);

  // ────────────────────────────────────────────────────────────────────────────
  // 5. VARIABLE SUBSTITUTION: {{variable}}, {{this}}, {{@special}}
  // ────────────────────────────────────────────────────────────────────────────
  result = replaceTemplateBounded(
    result,
    /\{\{([@\w.]+)\}\}/g,
    (match) => {
      const key = match[1];
      const value = data[key];
      if (value === null || value === undefined) {
        return match[0]; // Leave unresolved placeholders as-is
      }
      return String(value);
    },
    budget,
  );

  // Strip any unresolved {{> ...}} tags (unknown partials or partials-in-partials).
  result = replaceTemplateBounded(result, /\{\{>\s*\w+\s*\}\}/g, () => "", budget);

  return result;
}

export function compileSimpleTemplate(template: string, data: Record<string, unknown>): string {
  return compileSimpleTemplateWithBudget(template, data, createTemplateRenderBudget(), 0);
}

/**
 * Standard shared template blocks injected as partials at render time.
 *
 * Reference in any template body with {{> partial_name}}.
 * All variables are resolved from the same data object as the parent template.
 *
 * Available partials (loaded from DB via loadEmailPartials()):
 *   {{> sponsors_block}}  — conditional sponsors image section
 *   {{> about_pkic}}      — PKI Consortium blurb paragraph
 *   {{> reg_details}}     — registration details blockquote
 *   {{> donation_request}} — voluntary donation invite
 */

function wrapHtml(
  bodyHtml: string,
  layoutHtml: string,
  data: Record<string, unknown> = {},
  baseUrl = "https://pkic.org",
  budget = createTemplateRenderBudget(),
): string {
  if (!layoutHtml) return bodyHtml;

  const layout = compileSimpleTemplateWithBudget(layoutHtml, { baseUrl, ...data }, budget, 0);

  if (!layout.includes("{{{body_html}}}")) {
    throw new Error("Email layout template is missing the required {{{body_html}}} placeholder");
  }

  assertTemplateRenderLength(layout.length - "{{{body_html}}}".length + bodyHtml.length, budget);
  return layout.replace("{{{body_html}}}", bodyHtml);
}

function stripHtmlToText(input: string): string {
  const links: string[] = [];
  return input
    .replace(/<a\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, label) => {
      const text = stripHtmlToText(label);
      if (!href) return text;
      const placeholder = `__PKIC_EMAIL_LINK_${links.length}__`;
      links.push(`${text} <${href}>`);
      return placeholder;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|section|article|table|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/__PKIC_EMAIL_LINK_(\d+)__/g, (_match, index) => links[Number(index)] ?? "")
    .trim();
}

export async function renderEmail(
  template: string,
  data: Record<string, unknown>,
  layoutHtml: string,
  contentType: EmailContentType = "markdown",
  baseUrl = "https://pkic.org",
): Promise<{ html: string; text: string }> {
  const budget = createTemplateRenderBudget();
  // Inject baseUrl into template data so {{baseUrl}} resolves in body + partials.
  const dataWithBase = resolveEmailTemplateData({ baseUrl, ...data }, contentType);
  const rendered = compileSimpleTemplateWithBudget(template, dataWithBase, budget, 0);

  if (contentType === "html") {
    // Template is already HTML — wrap in layout but skip markdown processing.
    const html = wrapHtml(rendered, layoutHtml, dataWithBase, baseUrl, budget);
    const text = stripHtmlToText(rendered);
    return { html, text };
  }

  if (contentType === "text") {
    // Plain-text template — wrap a <pre>-based fallback, no markdown processor.
    const htmlBody = `<pre style="white-space:pre-wrap;font-family:inherit">${rendered.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
    assertTemplateRenderLength(htmlBody.length, budget);
    const html = wrapHtml(htmlBody, layoutHtml, dataWithBase, baseUrl, budget);
    return { html, text: stripHtmlToText(rendered) };
  }

  // Default: markdown
  const htmlBody = await marked.parse(rendered, {
    gfm: true,
    breaks: false,
  });
  assertTemplateRenderLength(htmlBody.length, budget);
  const html = wrapHtml(htmlBody, layoutHtml, dataWithBase, baseUrl, budget);

  const text = stripHtmlToText(htmlBody);

  return { html, text };
}

export function renderSubject(template: string | null, fallback: string, data: Record<string, unknown>): string {
  const subjectData = resolveEmailTemplateData(data, "subject");
  const budget = createTemplateRenderBudget(EMAIL_SUBJECT_RENDER_MAX_CHARS);
  const override = subjectData.__subjectOverride;
  if (typeof override === "string" && override.trim().length > 0) {
    const renderedOverride = override.replace(/[\r\n]+/g, " ").trim();
    assertTemplateRenderLength(renderedOverride.length, budget);
    return renderedOverride;
  }

  if (!template) {
    const renderedFallback = fallback.replace(/[\r\n]+/g, " ").trim();
    assertTemplateRenderLength(renderedFallback.length, budget);
    return renderedFallback;
  }

  const rendered = compileSimpleTemplateWithBudget(template, subjectData, budget, 0);
  return rendered.replace(/[\r\n]+/g, " ").trim();
}
