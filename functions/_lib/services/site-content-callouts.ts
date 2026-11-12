const ALERT_KINDS: Record<string, "info" | "warning"> = {
  NOTE: "info",
  TIP: "info",
  IMPORTANT: "info",
  WARNING: "warning",
  CAUTION: "warning",
};

const calloutClass = (kind: string) => `pk-content-callout pk-content-callout--${kind} callout-${kind}`;

/**
 * Turns callout Markdown into site callouts: pkic.org's trailing `{.callout-info}` marker and
 * GitHub alert syntax (`> [!NOTE]`), which model sources use so they read correctly on GitHub.
 */
export function contentCallouts(html: string): string {
  return html
    .replace(
      /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>\s*)?([\s\S]*?)<\/blockquote>/g,
      (_match, alert: string, body: string) =>
        `<blockquote class="${calloutClass(ALERT_KINDS[alert]!)}"><p>${body}`.replace(/<p>\s*<\/p>\s*/g, "") +
        "</blockquote>",
    )
    .replace(
      /<blockquote>\s*<p>([\s\S]*?)\s*\{\.callout-(info|warning)\}<\/p>\s*<\/blockquote>/g,
      (_match, body: string, kind: string) => `<blockquote class="${calloutClass(kind)}"><p>${body}</p></blockquote>`,
    )
    .replace(
      /<p>((?:(?!<\/p>)[\s\S])*?)\s*\{\.callout-(info|warning)\}<\/p>/g,
      (_match, body: string, kind: string) => `<div class="${calloutClass(kind)}"><p>${body}</p></div>`,
    );
}
