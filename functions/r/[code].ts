import { json, markSensitive } from "../_lib/http";
import { recordReferralClick } from "../_lib/services/referrals";
import { first } from "../_lib/db/queries";
import { resolveAppBaseUrl } from "../_lib/config";
import { getClientIp, getUserAgent, requireInternalSecret } from "../_lib/request";
import { registrationPageUrl } from "../_lib/services/frontend-links";
import type { PagesContext } from "../_lib/types";

// ─── Social-scraper detection ─────────────────────────────────────────────────

/**
 * Known social / link-preview crawlers that request URLs to generate previews.
 * We serve these an HTML page with OG meta tags instead of a 302 redirect so
 * that they see the personalised card image and title.
 */
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

function isSocialScraper(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return SCRAPER_UA_PATTERNS.some((re) => re.test(userAgent));
}

// ─── OG metadata lookup ───────────────────────────────────────────────────────

interface OgPersonRow {
  first_name: string | null;
  last_name: string | null;
  role: string;
  event_name: string;
}

async function lookupOgPerson(
  db: PagesContext["env"]["DB"],
  code: string,
): Promise<OgPersonRow | null> {
  // registration owners
  const registration = await first<OgPersonRow>(
    db,
    `SELECT u.first_name, u.last_name,
            'attendee' AS role,
            e.name     AS event_name
     FROM   referral_codes rc
     JOIN   registrations r ON r.id  = rc.owner_id
     JOIN   users  u  ON u.id  = r.user_id
     JOIN   events e  ON e.id  = rc.event_id
     WHERE  rc.code = ? AND rc.owner_type = 'registration'`,
    [code],
  );
  if (registration) return registration;

  // proposal/speaker owners
  return first<OgPersonRow>(
    db,
    `SELECT u.first_name, u.last_name,
            COALESCE(ps.role, 'speaker') AS role,
            e.name AS event_name
     FROM   referral_codes rc
     JOIN   session_proposals sp ON sp.id = rc.owner_id
     JOIN   users  u  ON u.id  = rc.created_by_user_id
     JOIN   events e  ON e.id  = sp.event_id
     LEFT   JOIN proposal_speakers ps
            ON  ps.proposal_id = sp.id
            AND ps.user_id     = u.id
     WHERE  rc.code = ? AND rc.owner_type = 'proposal'`,
    [code],
  );
}

// ─── OG HTML ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function roleToAction(role: string): string {
  switch (role) {
    case "moderator": return "is moderating";
    case "attendee":  return "is attending";
    default:          return "is speaking at";
  }
}

function buildOgHtml(
  code: string,
  appBaseUrl: string,
  redirectUrl: string,
  person: OgPersonRow | null,
): string {
  const name      = person ? `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() : "";
  const eventName = person?.event_name ?? "PKI Consortium Event";
  const action    = person ? roleToAction(person.role) : "is attending";

  const ogTitle       = name ? `${escapeHtml(name)} ${escapeHtml(action)} ${escapeHtml(eventName)}` : escapeHtml(eventName);
  const ogDescription = name
    ? `Join ${escapeHtml(name)} at ${escapeHtml(eventName)}. Register now at pkic.org.`
    : `Register for ${escapeHtml(eventName)} at pkic.org.`;

  const ogImage    = `${appBaseUrl}/api/v1/og/${encodeURIComponent(code)}`;
  const ogUrl      = `${appBaseUrl}/r/${encodeURIComponent(code)}`;
  const canonical  = escapeHtml(redirectUrl);
  const ogImageEsc = escapeHtml(ogImage);
  const ogUrlEsc   = escapeHtml(ogUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${canonical}">
  <title>${ogTitle}</title>

  <!-- Open Graph -->
  <meta property="og:type"        content="website">
  <meta property="og:url"         content="${ogUrlEsc}">
  <meta property="og:title"       content="${ogTitle}">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image"       content="${ogImageEsc}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type"  content="image/png">
  <meta property="og:site_name"   content="PKI Consortium">

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image"       content="${ogImageEsc}">

  <link rel="canonical" href="${canonical}">

  <style>
    body { margin: 0; background: #0f172a; color: #f8fafc;
           font-family: system-ui, sans-serif; display: flex;
           align-items: center; justify-content: center;
           min-height: 100vh; }
  </style>
</head>
<body>
  <p>Redirecting…</p>
  <script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</body>
</html>`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function onRequestGet(context: PagesContext<{ code: string }>): Promise<Response> {
  const signingSecret = requireInternalSecret(context.env);
  const appBaseUrl   = resolveAppBaseUrl(context.env);
  const code         = context.params.code;
  const userAgent    = getUserAgent(context.request);

  // ── Validate the code exists and get its event_id ─────────────────────────
  const refRow = await first<{ event_id: string }>(
    context.env.DB,
    "SELECT event_id FROM referral_codes WHERE code = ?",
    [code],
  );

  if (!refRow) {
    return json({ error: { code: "REFERRAL_NOT_FOUND", message: "Unknown referral code" } }, 404);
  }

  // ── For real browsers, record the click (fire-and-forget) ─────────────────
  // Scrapers are excluded so they don't inflate click counts.
  if (!isSocialScraper(userAgent)) {
    void recordReferralClick(context.env.DB, {
      code,
      ip: getClientIp(context.request),
      userAgent,
      secret: signingSecret,
    }).catch(() => { /* ignore */ });
  }

  // ── Resolve redirect URL and person data in parallel ──────────────────────
  const [eventRow, person] = await Promise.all([
    first<{ slug: string; base_path: string | null; starts_at: string | null; settings_json: string }>(
      context.env.DB,
      "SELECT slug, base_path, starts_at, settings_json FROM events WHERE id = ?",
      [refRow.event_id],
    ),
    lookupOgPerson(context.env.DB, code),
  ]);

  const redirectUrl = eventRow
    ? registrationPageUrl(appBaseUrl, eventRow, { ref: code, source: "referral_link" })
    : `${appBaseUrl}/events/`;

  // ── Always serve the OG HTML page ─────────────────────────────────────────
  // Using a meta-refresh (and JS fallback) instead of a 302 redirect means
  // every crawler — not just the ones in the UA whitelist — can read the
  // personalised Open Graph tags before being sent to the destination.
  return new Response(buildOgHtml(code, appBaseUrl, redirectUrl, person), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

export async function onRequest(context: PagesContext<{ code: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
