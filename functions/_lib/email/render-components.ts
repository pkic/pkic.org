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

/** Adds email-client-safe inline styles to the reusable CTA components. */
export function inlineEmailComponentStyles(html: string): string {
  return html.replace(/<div\b([^>]*)>\s*<a\b([^>]*)>/gi, (match, divAttributes: string, linkAttributes: string) => {
    const className = /\sclass=(['"])(.*?)\1/i.exec(divAttributes)?.[2] ?? "";
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    const kind = classes.has("cta")
      ? "cta"
      : classes.has("cta-navy")
        ? "cta-navy"
        : classes.has("cta-secondary")
          ? "cta-secondary"
          : null;
    if (!kind) return match;

    const secondary = kind === "cta-secondary";
    const background = kind === "cta" ? "#198754" : kind === "cta-navy" ? "#0d1b2a" : "#ffffff";
    const divStyle = secondary
      ? "text-align:center;margin:12px 0 28px;"
      : "text-align:center;margin:28px 0;mso-padding-alt:14px 36px;";
    const linkStyle = secondary
      ? "display:inline-block;color:#6b7280!important;text-decoration:none!important;font-size:13px;font-weight:400;padding:8px 20px;border-radius:6px;border:1px solid #d1d5db;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;background:#ffffff;"
      : `display:inline-block;color:#ffffff!important;text-decoration:none!important;font-size:15px;font-weight:700;padding:14px 36px;border-radius:6px;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;background:${background};`;

    return `<div${mergeInlineStyle(divAttributes, divStyle)}><a${mergeInlineStyle(linkAttributes, linkStyle)}>`;
  });
}
