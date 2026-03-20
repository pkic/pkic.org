/**
 * GET /donate/r/:code
 *
 * Personalised donation share link.  Each code maps to a row in
 * `donation_promoters` which in turn references a completed donation.
 *
 * Behaviour:
 *  - Social scrapers (LinkedIn, X, Slack, etc.) receive an HTML page with
 *    Open Graph meta tags that embed the donor's badge image as the preview
 *    card.  A <meta http-equiv="refresh"> in the <head> ensures human visitors
 *    who somehow end up here are still redirected.
 *  - Real browsers receive a 302 redirect to /donate/?ref=:code so the
 *    checkout page can carry forward the attribution.
 *  - Every real visit increments `donation_promoters.clicks`.
 */

import { json } from "../../_lib/http";
import { first, run } from "../../_lib/db/queries";
import { resolveAppBaseUrl } from "../../_lib/config";
import { getClientIp, getUserAgent } from "../../_lib/request";
import type { PagesContext } from "../../_lib/types";

// ─── Social-scraper detection (same list as /r/[code].ts) ────────────────────

const SCRAPER_UA_PATTERNS = [
  /Twitterbot/i,
  /LinkedInBot/i,
  /Linkedin-Bot/i,
  /facebookexternalhit/i,
  /Facebot/i,
  /Discordbot/i,
  /Slackbot/i,
  /Slack-ImgProxy/i,
  /TelegramBot/i,
  /WhatsApp/i,
  /iframely/i,
  /vkShare/i,
  /PinterestBot/i,
  /Mastodon/i,
  /Embedly/i,
  /google-xrawler/i,
  /rogerbot/i,
];

function isSocialScraper(ua: string | null): boolean {
  return !!ua && SCRAPER_UA_PATTERNS.some((re) => re.test(ua));
}

// ─── DB row types ─────────────────────────────────────────────────────────────

interface PromoterRow {
  code: string;
  checkout_session_id: string | null;
  name: string | null;
  clicks: number;
}

// ─── OG HTML builder ─────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPromoterOgHtml(
  code: string,
  appBaseUrl: string,
  promoter: PromoterRow,
  donateUrl: string,
): string {
  const sharerName  = promoter.name ? esc(promoter.name) : null;
  const ogTitle     = sharerName
    ? `${sharerName} is supporting the PKI Consortium`
    : "Support the PKI Consortium";
  const ogDesc      = "Help keep PKI memberships, resources, and events free and accessible worldwide.";
  const ogUrl       = esc(`${appBaseUrl}/donate/r/${encodeURIComponent(code)}`);
  const ogImage     = promoter.checkout_session_id
    ? esc(`${appBaseUrl}/api/v1/og/donation/${encodeURIComponent(promoter.checkout_session_id)}`)
    : esc(`${appBaseUrl}/images/donate-og.jpg`); // fallback static image
  const canonical   = esc(donateUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${canonical}">
  <title>${ogTitle}</title>

  <meta property="og:type"         content="website">
  <meta property="og:url"          content="${ogUrl}">
  <meta property="og:title"        content="${ogTitle}">
  <meta property="og:description"  content="${ogDesc}">
  <meta property="og:image"        content="${ogImage}">
  <meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type"   content="image/jpeg">
  <meta property="og:site_name"    content="PKI Consortium">

  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${ogTitle}">
  <meta name="twitter:description" content="${ogDesc}">
  <meta name="twitter:image"       content="${ogImage}">

  <link rel="canonical" href="${canonical}">

  <style>
    body { margin:0; background:#0f172a; color:#f8fafc;
           font-family:system-ui,sans-serif; display:flex;
           align-items:center; justify-content:center; min-height:100vh; }
  </style>
</head>
<body>
  <p>Redirecting…</p>
  <script>window.location.replace(${JSON.stringify(donateUrl)});</script>
</body>
</html>`;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function onRequestGet(context: PagesContext<{ code: string }>): Promise<Response> {
  const { env, request, params } = context;
  const code      = params.code;
  const appBase   = resolveAppBaseUrl(env);
  const userAgent = getUserAgent(request);

  const promoter = await first<PromoterRow>(
    env.DB,
    "SELECT code, checkout_session_id, name, clicks FROM donation_promoters WHERE code = ?",
    [code],
  );

  if (!promoter) {
    // Unknown code — redirect to donate page rather than a hard 404
    return Response.redirect(`${appBase}/donate/`, 302);
  }

  const donateUrl = `${appBase}/donate/?ref=${encodeURIComponent(code)}`;

  // ── For real browsers, record the click (fire-and-forget) ─────────────────
  // Scrapers are excluded so they don't inflate click counts.
  if (!isSocialScraper(userAgent)) {
    void run(env.DB, "UPDATE donation_promoters SET clicks = clicks + 1 WHERE code = ?", [code]).catch(() => {
      /* ignore */
    });
  }

  // ── Always serve the OG HTML page ─────────────────────────────────────────
  // Using a meta-refresh (and JS fallback) instead of a 302 redirect means
  // every crawler — not just the ones in the UA whitelist — can read the
  // personalised Open Graph tags before being sent to the destination.
  return new Response(buildPromoterOgHtml(code, appBase, promoter, donateUrl), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

export async function onRequest(context: PagesContext<{ code: string }>): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
