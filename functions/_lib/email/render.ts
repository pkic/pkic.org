import { marked } from "marked";

// ─── Conditional template helpers ────────────────────────────────────────────

function isTruthy(value: unknown): boolean {
  return Boolean(value) && value !== "false" && value !== "0" && value !== "";
}

function evaluateIfCondition(condition: string, data: Record<string, unknown>): boolean {
  // {{#if and var1 var2 ...}}
  if (condition.startsWith("and ")) {
    return condition.slice(4).trim().split(/\s+/).filter(Boolean).every(c => isTruthy(data[c]));
  }
  // {{#if or var1 var2 ...}}
  if (condition.startsWith("or ")) {
    return condition.slice(3).trim().split(/\s+/).filter(Boolean).some(c => isTruthy(data[c]));
  }
  // {{#if eq|ne|gt|gte|lt|lte var "literal"}}
  const cmpMatch = /^(eq|ne|gt|gte|lt|lte)\s+(\w+)\s+"([^"]*)"$/.exec(condition);
  if (cmpMatch) {
    const [, op, variable, literal] = cmpMatch;
    const value = String(data[variable] ?? "");
    const n = parseFloat(value), nl = parseFloat(literal);
    switch (op) {
      case "eq":  return value === literal;
      case "ne":  return value !== literal;
      case "gt":  return !isNaN(n) && !isNaN(nl) && n > nl;
      case "gte": return !isNaN(n) && !isNaN(nl) && n >= nl;
      case "lt":  return !isNaN(n) && !isNaN(nl) && n < nl;
      case "lte": return !isNaN(n) && !isNaN(nl) && n <= nl;
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
  openPrefix: string,   // e.g., "{{#if "  — increments depth
  closeTag: string,     // e.g., "{{/if}}" — decrements depth
): number {
  let depth = 1;
  let pos = searchFrom;
  while (pos < template.length) {
    const nextOpen  = template.indexOf(openPrefix, pos);
    const nextClose = template.indexOf(closeTag,  pos);
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
function findElseAtDepth0(
  content: string,
  openPrefix: string,
  closeTag: string,
): number {
  let depth = 0;
  let pos = 0;
  while (pos < content.length) {
    const nextOpen  = content.indexOf(openPrefix, pos);
    const nextClose = content.indexOf(closeTag,   pos);
    const nextElse  = content.indexOf("{{else}}", pos);

    const openAt  = nextOpen  !== -1 ? nextOpen  : Infinity;
    const closeAt = nextClose !== -1 ? nextClose : Infinity;
    const elseAt  = nextElse  !== -1 ? nextElse  : Infinity;

    const earliest = Math.min(openAt, closeAt, elseAt);
    if (!isFinite(earliest)) break;

    if (elseAt === earliest && depth === 0) return nextElse;
    if (openAt === earliest) {
      depth++;
      const innerClose = content.indexOf("}}", nextOpen + openPrefix.length);
      pos = innerClose !== -1 ? innerClose + 2 : nextOpen + openPrefix.length;
    } else {
      depth--;
      pos = nextClose + closeTag.length;
    }
  }
  return -1;
}

/**
 * Recursively resolves all {{#if}} / {{#unless}} / {{else}} / {{/if}} / {{/unless}}
 * blocks in `template` using a depth-counting scanner rather than regex.
 * This correctly handles arbitrary nesting without ambiguity.
 */
function resolveAllConditionals(template: string, data: Record<string, unknown>): string {
  let result = "";
  let pos = 0;

  while (pos < template.length) {
    const ifIdx     = template.indexOf("{{#if ", pos);
    const unlessIdx = template.indexOf("{{#unless ", pos);

    // No more conditional tags — append remainder and stop.
    if (ifIdx === -1 && unlessIdx === -1) {
      result += template.slice(pos);
      break;
    }

    const isUnless  = unlessIdx !== -1 && (ifIdx === -1 || unlessIdx < ifIdx);
    const tagIdx    = isUnless ? unlessIdx : ifIdx;
    const openPfx   = isUnless ? "{{#unless " : "{{#if ";
    const closeTag  = isUnless ? "{{/unless}}" : "{{/if}}";

    // Append literal text before this tag.
    result += template.slice(pos, tagIdx);

    // Find the end of the opening tag.
    const condEnd = template.indexOf("}}", tagIdx + openPfx.length);
    if (condEnd === -1) {
      // Malformed — emit as-is and stop.
      result += template.slice(tagIdx);
      break;
    }

    const condition  = template.slice(tagIdx + openPfx.length, condEnd).trim();
    const openTagEnd = condEnd + 2;

    // Find the matching close tag (depth-aware).
    const closeAt = findMatchingCloseTag(template, openTagEnd, openPfx, closeTag);
    if (closeAt === -1) {
      // Unmatched tag — emit the opening tag text and keep scanning.
      result += template.slice(tagIdx, openTagEnd);
      pos = openTagEnd;
      continue;
    }

    const blockContent = template.slice(openTagEnd, closeAt);
    const afterBlock   = closeAt + closeTag.length;

    // Find {{else}} at depth 0 within the block.
    const elseAt      = findElseAtDepth0(blockContent, openPfx, closeTag);
    const ifContent   = elseAt !== -1 ? blockContent.slice(0, elseAt) : blockContent;
    const elseContent = elseAt !== -1 ? blockContent.slice(elseAt + "{{else}}".length) : "";

    // Evaluate and recursively process the chosen branch.
    const isTrue  = isUnless
      ? !isTruthy(data[condition])
      : evaluateIfCondition(condition, data);
    result += resolveAllConditionals(isTrue ? ifContent : elseContent, data);

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
 *    (1-level deep only — prevents loops). Unknown partials render as empty string.
 *    The EMAIL_PARTIALS constant in this file defines the standard shared blocks;
 *    inject via: { ...data, _partials: EMAIL_PARTIALS } before rendering.
 *
 * LIMITATIONS:
 * - No nested conditionals or loops
 * - No custom Handlebars helpers
 * - Comparison/logical operators work in uppercase only: {{#if EQ ...}} fails
 * - {{#for}} syntax is NOT supported; use {{#each}} or {{#each array as |item|}}
 * - Partials are 1-level deep only; nested {{> ...}} inside a partial are stripped
 *
 * WHY CUSTOM:
 * Cloudflare Workers blocks Handlebars.compile() because it uses eval/new Function().
 * This engine trades Handlebars' full feature set for CSP compliance.
 */
export function compileSimpleTemplate(template: string, data: Record<string, unknown>): string {
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
      result = result.replace(/\{\{>\s*(\w+)\s*\}\}/g, (_match, name: string) => {
        const partialContent = partials[name];
        if (partialContent === undefined) return "";
        // Compile the partial — recursive call has no _partials, blocking further nesting.
        return compileSimpleTemplate(partialContent, dataForPartial);
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 1. LOOPS: {{#each array}}...{{/each}}
  //    Processes nested conditionals inside loop content.
  // ────────────────────────────────────────────────────────────────────────────
  result = result.replace(
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (match, arrayVar, content) => {
      const array = data[arrayVar];
      if (!Array.isArray(array)) {
        return ""; // Not an array, skip loop
      }

      return array
        .map((item, index) => {
          let loopContent = content;
          
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
          loopContent = compileSimpleTemplate(loopContent, loopData);
          
          return loopContent;
        })
        .join("");
    }
  );

  // ────────────────────────────────────────────────────────────────────────────
  // 2–4. CONDITIONALS — depth-counting scanner (handles arbitrary nesting)
  //
  //   Delegates to resolveAllConditionals() which walks the template string
  //   once, using findMatchingCloseTag() to correctly pair every {{#if}} with
  //   its own {{/if}} regardless of how deeply nested the blocks are.
  //   Supports all forms: {{#if var}}, {{#if eq}}, {{#if and/or}}, {{#unless}}.
  // ────────────────────────────────────────────────────────────────────────────
  result = resolveAllConditionals(result, data);

  // ────────────────────────────────────────────────────────────────────────────
  // 5. VARIABLE SUBSTITUTION: {{variable}}, {{this}}, {{@special}}
  // ────────────────────────────────────────────────────────────────────────────
  result = result.replace(/\{\{([@\w\.]+)\}\}/g, (match, key) => {
    const value = data[key];
    if (value === null || value === undefined) {
      return match; // Leave unresolved placeholders as-is
    }
    return String(value);
  });

  // Strip any unresolved {{> ...}} tags (unknown partials or partials-in-partials).
  result = result.replace(/\{\{>\s*\w+\s*\}\}/g, "");

  return result;
}

/**
 * Standard shared template blocks injected as partials at render time.
 *
 * Reference in any template body with {{> partial_name}}.
 * All variables are resolved from the same data object as the parent template.
 *
 * Available partials:
 *   {{> sponsors_block}}  — conditional sponsors image section
 *   {{> about_pkic}}      — PKI Consortium blurb paragraph
 *   {{> reg_details}}     — registration details blockquote
 */
export const EMAIL_PARTIALS: Record<string, string> = {
  sponsors_block: `{{#if sponsorsImageUrl}}

<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #e5e9ef;margin:28px 0 0;">
  <tr>
    <td align="center" style="padding:24px 0 8px;">
      <p style="margin:0 0 16px;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Event sponsors</p>
      <a href="{{baseUrl}}/sponsors/" target="_blank" style="display:block;text-decoration:none;">
        <img src="{{sponsorsImageUrl}}" alt="Event sponsors" width="504" style="display:block;max-width:100%;height:auto;border:0;">
      </a>
    </td>
  </tr>
</table>

{{/if}}`,

  about_pkic: `**About the PKI Consortium**

The PKI Consortium is a vendor-neutral community of PKI practitioners dedicated to advancing trust, security, and interoperability in digital infrastructure. [Learn more &rarr;]({{baseUrl}})`,

  reg_details: `## Your registration details

> {{#if firstName}}**Name:** {{firstName}} {{lastName}}  \n> {{/if}}{{#if email}}**Email:** {{email}}  \n> {{/if}}{{#if organizationName}}**Organization:** {{organizationName}}  \n> {{/if}}{{#if jobTitle}}**Title / Role:** {{jobTitle}}  \n> {{/if}}{{#each dayAttendance}}**{{dayLabel}}:** {{attendanceLabel}}  \n> {{/each}}{{#if attendanceLabel}}**Attendance:** {{attendanceLabel}}  \n> {{/if}}{{#each customAnswerRows}}**{{label}}:** {{displayValue}}  \n> {{/each}}{{#if acceptedTermsText}}**Terms agreed:**  \n> - {{acceptedTermsText}}{{/if}}`,

};

function buildDefaultLayout(baseUrl: string): string {
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    /* ── Resets ────────────────────────────────────────────────────*/
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none}
    table{border-collapse:collapse!important}
    body{height:100%!important;margin:0!important;padding:0!important;width:100%!important;background-color:#f0f4f8}

    /* ── iOS auto-linking ──────────────────────────────────────────*/
    a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}

    /* ── Gmail link color override ────────────────────────────────*/
    u+#body a{color:inherit!important;text-decoration:none!important}

    /* ── Markdown-rendered body HTML (.eb = email body) ───────────*/
    .eb h1{font-size:24px;font-weight:700;color:#0d1b2a;margin:0 0 20px;line-height:1.3;letter-spacing:-0.01em}
    .eb h2{font-size:18px;font-weight:700;color:#0d1b2a;margin:28px 0 10px;line-height:1.35;padding-bottom:8px;border-bottom:2px solid #f0f4f8}
    .eb h3{font-size:14px;font-weight:700;color:#198754;margin:20px 0 8px;text-transform:uppercase;letter-spacing:0.04em}
    .eb p{margin:0 0 16px;color:#374151;line-height:1.75}
    .eb p:last-child{margin-bottom:0}
    .eb a{color:#198754;text-decoration:underline;font-weight:500}
    .eb strong{color:#0d1b2a;font-weight:700}
    .eb em{color:#4b5563;font-style:italic}
    .eb ul,.eb ol{margin:0 0 16px;padding-left:22px;color:#374151}
    .eb li{margin-bottom:6px;line-height:1.65}
    .eb blockquote li{font-size:13px;margin-bottom:3px;line-height:1.55}
    .eb hr{border:none;border-top:1px solid #e5e9ef;margin:28px 0}
    .eb blockquote{margin:20px 0;padding:14px 20px;background:#f8fafc;border-left:4px solid #198754;border-radius:0 6px 6px 0;color:#4b5563}
    .eb blockquote p{margin:0;color:#4b5563;font-style:italic}
    .eb blockquote strong{color:#374151}
    .eb blockquote a{color:#374151;text-decoration:underline}
    .eb code{font-family:'Courier New',Courier,monospace;font-size:13px;background:#f1f5f9;padding:2px 7px;border-radius:4px;color:#0d1b2a;border:1px solid #e5e9ef}
    .eb pre{background:#f8fafc;border:1px solid #e5e9ef;border-radius:6px;padding:16px;font-size:13px;overflow:auto;margin:0 0 16px}
    .eb table{width:100%;border-collapse:collapse;margin:0 0 20px}
    .eb th{background:#f8fafc;border-bottom:2px solid #e5e9ef;color:#0d1b2a;font-size:13px;font-weight:700;padding:10px 14px;text-align:left}
    .eb td{border-bottom:1px solid #f0f4f8;color:#374151;font-size:14px;padding:10px 14px;vertical-align:top}
    .eb tr:last-child td{border-bottom:none}

    /* ── Notice / callout boxes ─────────────────────────────────── */
    .notice{margin:16px 0;padding:14px 18px;border-radius:6px;border-left:4px solid;font-size:14px;line-height:1.65}
    .notice-success{background:#f0f7f4;border-color:#198754;color:#14532d}
    .notice-warning{background:#fffbeb;border-color:#d97706;color:#92400e}
    .notice-info{background:#eff6ff;border-color:#3b82f6;color:#1e40af}
    .notice-danger{background:#fef2f2;border-color:#ef4444;color:#991b1b}
    .notice a,.notice strong{color:inherit}

    /* ── CTA buttons ────────────────────────────────────────────── */
    .cta,.cta-navy{text-align:center;margin:28px 0}
    .cta a,.cta-navy a{display:inline-block;color:#ffffff!important;text-decoration:none!important;font-size:15px;font-weight:700;padding:14px 36px;border-radius:6px;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif}
    .cta a{background:#198754}
    .cta-navy a{background:#0d1b2a}
    .cta-secondary{text-align:center;margin:12px 0 28px}
    .cta-secondary a{display:inline-block;color:#6b7280!important;text-decoration:none!important;font-size:13px;font-weight:400;padding:8px 20px;border-radius:6px;border:1px solid #d1d5db;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;background:#ffffff}

    /* ── Responsive ────────────────────────────────────────────────*/
    @media only screen and (max-width:680px){
      .ew{width:100%!important;border-radius:0!important}
      .ep{padding:28px 24px!important}
      .ef{padding:20px 24px!important}
      .eh{padding:24px!important}
    }

    /* ── Dark mode ─────────────────────────────────────────────────*/
    @media (prefers-color-scheme:dark){
      body,.ow{background-color:#0f172a!important}
      .eb{background-color:#1e2235!important;color:#d1d5db!important}
      .eb h1{color:#f9fafb!important}
      .eb h2{color:#f9fafb!important;border-bottom-color:#374151!important}
      .eb h3{color:#4ade80!important}
      .eb p{color:#d1d5db!important}
      .eb a{color:#4ade80!important}
      .eb strong{color:#f9fafb!important}
      .eb em{color:#9ca3af!important}
      .eb ul,.eb ol,.eb li{color:#d1d5db!important}
      .eb hr{border-top-color:#374151!important}
      .eb blockquote{background:#1a2744!important;border-left-color:#4ade80!important}
      .eb blockquote p{color:#9ca3af!important}
      .eb blockquote strong{color:#d1d5db!important}
      .eb blockquote a{color:#9ca3af!important}
      .eb code{background:#0f172a!important;color:#e2e8f0!important;border-color:#374151!important}
      .eb pre{background:#0f172a!important;border-color:#374151!important}
      .eb th{background:#263148!important;color:#f9fafb!important;border-bottom-color:#374151!important}
      .eb td{border-bottom-color:#374151!important;color:#d1d5db!important}
      .notice-success{background:#0f2a1c!important;color:#86efac!important}
      .notice-warning{background:#2a1f0f!important;color:#fbbf24!important}
      .notice-info{background:#0f1f3a!important;color:#93c5fd!important}
      .notice-danger{background:#2a0f0f!important;color:#fca5a5!important}
    }
  </style>
</head>
<body id="body" style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Preheader ghost text — pads inbox preview away from subject line -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">PKI Consortium &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>

  <!-- Outer wrapper -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="ow" style="background-color:#f0f4f8;">
    <tr>
      <td align="center" style="padding:32px 12px;">

        <!-- Email card — max 660px, rounded, shadowed -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="660" class="ew"
               style="max-width:660px;width:100%;border-radius:10px;overflow:hidden;
                      box-shadow:0 2px 4px rgba(0,0,0,0.05),0 8px 32px rgba(0,0,0,0.08);">

          <!-- ─── HEADER — black + white logo (core brand) ─────────────── -->
          <tr>
            <td class="eh" align="center" style="background-color:#000000;padding:28px 40px;text-align:center;">
              <a href="${baseUrl}" target="_blank" style="text-decoration:none;display:inline-block;line-height:1;">
                <img src="${baseUrl}/img/logo-white.png"
                     width="160" alt="PKI Consortium"
                     style="display:block;width:160px;max-width:160px;height:auto;border:0;">
              </a>
            </td>
          </tr>

          <!-- ─── BRAND STRIPE — full rainbow gradient (nav/footer core) ── -->
          <tr>
            <td style="padding:0;font-size:0;line-height:0;
                background:linear-gradient(to right,#198754,#20c997,#5a9bd5,#ffc107,#ed7d31,#dc3545);
                height:5px;line-height:5px;">&nbsp;</td>
          </tr>

          {{{hero_section}}}

          <!-- ─── BODY ─────────────────────────────────────────────── -->
          <tr>
            <td class="ep eb" style="background-color:#ffffff;padding:40px 40px;
                font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;
                font-size:16px;line-height:1.75;color:#374151;">
              {{{body_html}}}
            </td>
          </tr>

          <!-- ─── FOOTER ───────────────────────────────────────────── -->
          <tr>
            <td class="ef" style="background-color:#0d1b2a;padding:24px 40px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;
                      font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">
                    <p style="margin:0 0 8px;">
                      <a href="${baseUrl}" target="_blank"
                         style="color:#4ade80;text-decoration:none;font-weight:600;">pkic.org</a>
                      <span style="color:#374151;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
                      <a href="${baseUrl}/privacy/" target="_blank"
                         style="color:#6b7280;text-decoration:none;">Privacy Policy</a>
                      <span style="color:#374151;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
                      <a href="${baseUrl}/join/" target="_blank"
                         style="color:#6b7280;text-decoration:none;">Become a Member</a>
                    </p>
                    <p style="margin:0;color:#4b5563;font-size:11px;">
                      &copy; PKI Consortium &mdash; Advancing trust and security in digital infrastructure.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Email card -->

      </td>
    </tr>
  </table>
  <!-- /Outer wrapper -->

</body>
</html>`;
}

function buildHeroHtml(heroImageUrl: string): string {
  return `<tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <img src="${heroImageUrl}" width="660" alt=""
                   style="display:block;width:100%;max-width:660px;height:auto;border:0;">
            </td>
          </tr>`;
}

function wrapHtml(
  bodyHtml: string,
  layoutHtml?: string | null,
  heroImageUrl?: string | null,
  baseUrl = "https://pkic.org",
): string {
  const layout = layoutHtml?.trim() ? layoutHtml : buildDefaultLayout(baseUrl);
  const heroHtml = heroImageUrl ? buildHeroHtml(heroImageUrl) : "";

  let result: string;
  if (layout.includes("{{{body_html}}}")) {
    result = layout.replace("{{{body_html}}}", bodyHtml);
  } else if (layout.includes("{{body_html}}")) {
    result = layout.replace("{{body_html}}", bodyHtml);
  } else if (layout.includes("<!-- BODY_HTML -->")) {
    result = layout.replace("<!-- BODY_HTML -->", bodyHtml);
  } else {
    result = buildDefaultLayout(baseUrl).replace("{{{body_html}}}", bodyHtml);
  }

  return result.replace("{{{hero_section}}}", heroHtml);
}

export async function renderEmail(
  template: string,
  data: Record<string, unknown>,
  layoutHtml?: string | null,
  contentType: "markdown" | "html" | "text" = "markdown",
  baseUrl = "https://pkic.org",
): Promise<{ html: string; text: string }> {
  // Inject baseUrl into template data so {{baseUrl}} resolves in body + partials.
  const dataWithBase: Record<string, unknown> = { baseUrl, ...data };
  const rendered = compileSimpleTemplate(template, dataWithBase);
  const heroImageUrl = typeof dataWithBase.heroImageUrl === "string" ? dataWithBase.heroImageUrl : null;

  if (contentType === "html") {
    // Template is already HTML — wrap in layout but skip markdown processing.
    const html = wrapHtml(rendered, layoutHtml, heroImageUrl, baseUrl);
    const text = rendered
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { html, text };
  }

  if (contentType === "text") {
    // Plain-text template — wrap a <pre>-based fallback, no markdown processor.
    const htmlBody = `<pre style="white-space:pre-wrap;font-family:inherit">${rendered.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
    const html = wrapHtml(htmlBody, layoutHtml, heroImageUrl, baseUrl);
    return { html, text: rendered.trim() };
  }

  // Default: markdown
  const htmlBody = await marked.parse(rendered, {
    gfm: true,
    breaks: false,
  });
  const html = wrapHtml(htmlBody, layoutHtml, heroImageUrl, baseUrl);

  const text = rendered
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 <$2>")
    .replace(/[#*_`>]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { html, text };
}

export function renderSubject(template: string | null, fallback: string, data: Record<string, unknown>): string {
  const override = data.__subjectOverride;
  if (typeof override === "string" && override.trim().length > 0) {
    return override.replace(/[\r\n]+/g, " ").trim();
  }

  if (!template) {
    return fallback.replace(/[\r\n]+/g, " ").trim();
  }

  const rendered = compileSimpleTemplate(template, data);
  return rendered.replace(/[\r\n]+/g, " ").trim();
}
