export const EMAIL_PREVIEW_DOCUMENT_PATH = "/email/preview/";

const featurePaths = {
  portal: ["/portal/"],
  payment: ["/donate/"],
  assessment: ["/wg/pkimm/assessment/", "/wg/pkimm/1.0.0/tools/self-assessment/"],
  questions: ["/questions"],
} as const;

/** The same allowlist protects native static responses and Worker-rendered shells. */
export function siteContentSecurityPolicy(pathname = "/"): string {
  if (pathname === EMAIL_PREVIEW_DOCUMENT_PATH) {
    // Only this trusted bridge may frame email HTML with inline email styling.
    // Its nested iframe has an empty sandbox, so email scripts/forms stay disabled.
    return "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src https: data:; font-src https: data:; frame-src 'self'; connect-src 'none'";
  }
  const portal = pathname.startsWith("/portal/");
  const payment = featurePaths.payment.some((path) => pathname.startsWith(path));
  const assessment = featurePaths.assessment.some((path) => pathname.startsWith(path));
  const questions = featurePaths.questions.some((path) => pathname.startsWith(path));
  const script = ["'self'", "'wasm-unsafe-eval'", "https://challenges.cloudflare.com"];
  const connect = ["'self'"];
  const images = ["'self'", "data:", "https://i.ytimg.com"];
  const frames = [
    "https://challenges.cloudflare.com",
    "https://www.youtube-nocookie.com",
    "https://www.youtube.com",
    "https://player.vimeo.com",
  ];
  if (portal) frames.push("'self'");
  if (questions) connect.push("https://docs.google.com/spreadsheets/d/");
  if (payment) {
    // Embedded Checkout, Stripe.js, redirects, and Link; restricted to donation pages.
    script.push("https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com");
    connect.push("https://api.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com");
    frames.push(
      "https://js.stripe.com",
      "https://*.js.stripe.com",
      "https://hooks.stripe.com",
      "https://checkout.stripe.com",
      "https://link.com",
      "https://*.link.com",
    );
    images.push("https://*.stripe.com", "https://*.link.com");
  }
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${script.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self'",
    // The released assessment SDK injects 41 stylesheets. Their hash list exceeds
    // Cloudflare's 2,000-character header line limit. Keep this exception local
    // to the assessment; inline script and style attributes remain forbidden.
    ...(assessment ? ["style-src-elem 'self' 'unsafe-inline'"] : []),
    "style-src-attr 'none'",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    `img-src ${images.join(" ")}`,
    `frame-src ${frames.join(" ")}`,
    "worker-src 'self' blob:",
    // The installable portal reads its own web app manifest; nothing else needs one.
    ...(portal ? ["manifest-src 'self'"] : []),
    "media-src 'self' https://www.rovid.nl/def/dco/2016/def-dco-20160823-idoa9bivg-web-hd.mp4",
  ].join("; ");
}

export function siteSecurityHeaders(pathname = "/") {
  return {
    "Content-Security-Policy": siteContentSecurityPolicy(pathname),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": pathname === EMAIL_PREVIEW_DOCUMENT_PATH ? "SAMEORIGIN" : "DENY",
    "Referrer-Policy": pathname === EMAIL_PREVIEW_DOCUMENT_PATH ? "no-referrer" : "strict-origin-when-cross-origin",
    ...(pathname === EMAIL_PREVIEW_DOCUMENT_PATH ? { "X-Robots-Tag": "noindex, nofollow, noarchive" } : {}),
    "Strict-Transport-Security": "max-age=31536000",
    "Permissions-Policy": `${pathname.startsWith("/portal/") ? "camera=(self)" : "camera=()"}, microphone=(), geolocation=(), browsing-topics=()`,
  };
}

/** Generate Cloudflare's native header file without maintaining another policy copy. */
export function siteStaticHeaders(): string {
  const global = Object.entries(siteSecurityHeaders())
    .map(([name, value]) => `    ${name}: ${value}`)
    .join("\n");
  const features = Object.values(featurePaths)
    .flat()
    .map((path) => {
      // Cloudflare replaces an earlier rule with the same path rather than merging it.
      const camera =
        path === "/portal/"
          ? `\n    ! Permissions-Policy\n    Permissions-Policy: ${siteSecurityHeaders(path)["Permissions-Policy"]}`
          : "";
      return `${path}*\n    ! Content-Security-Policy\n    Content-Security-Policy: ${siteContentSecurityPolicy(path)}${camera}`;
    })
    .join("\n\n");
  const previewPolicy = siteSecurityHeaders(EMAIL_PREVIEW_DOCUMENT_PATH);
  const preview = `${EMAIL_PREVIEW_DOCUMENT_PATH}\n    ! Content-Security-Policy\n    ! X-Frame-Options\n    ! Referrer-Policy\n    Content-Security-Policy: ${previewPolicy["Content-Security-Policy"]}\n    X-Frame-Options: ${previewPolicy["X-Frame-Options"]}\n    Referrer-Policy: ${previewPolicy["Referrer-Policy"]}\n    X-Robots-Tag: ${previewPolicy["X-Robots-Tag"]}`;
  return `# Generated by scripts/generate-site-security-headers.mjs.\n\nhttps://:project.pages.dev/*\n    X-Robots-Tag: noindex\n\n/*\n${global}\n\n${features}\n\n${preview}\n\n/meetings/join/*\n    ! Cache-Control\n    Cache-Control: no-store, max-age=0\n    ! Referrer-Policy\n    Referrer-Policy: no-referrer\n    X-Robots-Tag: noindex, nofollow, noarchive\n\n/m/*\n    ! Cache-Control\n    Cache-Control: no-store, max-age=0\n    ! Referrer-Policy\n    Referrer-Policy: no-referrer\n    X-Robots-Tag: noindex, nofollow, noarchive\n\n/js/built/*\n    ! Cache-Control\n    Cache-Control: public, max-age=31536000, immutable\n    Service-Worker-Allowed: /portal/\n\n/_assets/*\n    Service-Worker-Allowed: /portal/\n`;
}
