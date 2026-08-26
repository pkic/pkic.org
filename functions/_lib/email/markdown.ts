/**
 * Renders untrusted plain text literally when it is interpolated into a
 * trusted Markdown email template. Template-authored Markdown and trusted
 * server URLs remain active; public text cannot introduce links, images, raw
 * HTML, headings, lists, or block quotes.
 */
export function escapeMarkdownText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]{}()#+.!|~=-])/g, "\\$1")
    .replace(/:/g, "\\:");
}
