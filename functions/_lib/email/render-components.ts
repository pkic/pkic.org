import type { ContentButtonVariant } from "../../../assets/shared/schemas/content-layout";
function mergeInlineStyle(attributes: string, style: string): string {
  const styleAttribute = /\sstyle=(['"])([\s\S]*?)\1/i;
  if (styleAttribute.test(attributes)) {
    return attributes.replace(styleAttribute, (_match, quote: string, current: string) => {
      const separator = current.trim().endsWith(";") ? "" : ";";
      return ` style=${quote}${current}${separator}${style}${quote}`;
    });
  }
  return `${attributes} style="${style}"`;
}

/** Uses the deployed origin for branding, but never embeds an unreachable loopback asset URL. */
export function resolveEmailBrandBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1") {
      return "https://pkic.org";
    }
    return url.origin;
  } catch {
    return "https://pkic.org";
  }
}

export const EMAIL_FONT_FAMILY = "'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";
const BUTTON_BASE = `display:inline-block;text-decoration:none!important;font-size:15px;font-weight:700;line-height:1.3;padding:13px 32px;border-radius:6px;font-family:${EMAIL_FONT_FAMILY};`;

/** One look per editor button variant, shared by authored buttons and the earlier CTA markup. */
export const EMAIL_BUTTON_STYLES: Record<ContentButtonVariant, string> = {
  primary: `${BUTTON_BASE}color:#ffffff!important;background:#198754;border:1px solid #198754;`,
  secondary: `${BUTTON_BASE}color:#0d1b2a!important;background:#ffffff;border:1px solid #d1d5db;`,
  ghost: `${BUTTON_BASE}color:#4b5563!important;background:transparent;border:1px solid transparent;`,
  link: "color:#198754!important;text-decoration:underline!important;font-weight:600;",
};

const LEGACY_CTA_VARIANTS: Record<string, ContentButtonVariant> = {
  cta: "primary",
  "cta-navy": "primary",
  "cta-secondary": "secondary",
};

/** Adds email-client-safe inline styles to the earlier `<div class="cta">` buttons that saved templates still use. */
export function inlineEmailComponentStyles(html: string): string {
  return html.replace(/<div\b([^>]*)>\s*<a\b([^>]*)>/gi, (match, divAttributes: string, linkAttributes: string) => {
    const className = /\sclass=(['"])(.*?)\1/i.exec(divAttributes)?.[2] ?? "";
    const kind = className.split(/\s+/).find((name) => name in LEGACY_CTA_VARIANTS);
    if (!kind) return match;
    const variant = LEGACY_CTA_VARIANTS[kind]!;
    const divStyle =
      variant === "secondary" ? "text-align:center;margin:12px 0 28px;" : "text-align:center;margin:28px 0;";
    return `<div${mergeInlineStyle(divAttributes, divStyle)}><a${mergeInlineStyle(linkAttributes, EMAIL_BUTTON_STYLES[variant])}>`;
  });
}
