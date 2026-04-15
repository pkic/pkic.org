import { json } from "../_lib/http";
import { recordReferralClick } from "../_lib/services/referrals";
import { first } from "../_lib/db/queries";
import { resolveAppBaseUrl } from "../_lib/config";
import { getClientIp, getUserAgent, requireInternalSecret } from "../_lib/request";
import { registrationPageUrl } from "../_lib/services/frontend-links";
import { resolveOgImageType } from "../_lib/utils/og-image-type";
import type { DatabaseLike } from "../_lib/types";
// ─── Social-scraper detection ─────────────────────────────────────────────────

/**
 * Known social / link-preview crawlers that request URLs to generate previews.
 * We still identify them so they do not increment click counts.
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

type EventFormat = "conference" | "webinar" | "other";

async function lookupOgPerson(db: DatabaseLike, code: string): Promise<OgPersonRow | null> {
  // registration owners
  const registration = await first<OgPersonRow>(
    db,
    `SELECT u.first_name, u.last_name,
            COALESCE((
              SELECT ep2.role
              FROM   event_participants ep2
              WHERE  ep2.event_id = r.event_id
                AND  ep2.user_id  = r.user_id
                AND  ep2.role    != 'attendee'
                AND  ep2.status   = 'active'
                AND (
                  ep2.source_type != 'proposal'
                  OR EXISTS (
                    SELECT 1
                    FROM session_proposals sp2
                    WHERE sp2.id = ep2.source_ref
                      AND sp2.status = 'accepted'
                  )
                )
              ORDER BY CASE ep2.role
                WHEN 'speaker'   THEN 1
                WHEN 'moderator' THEN 2
                WHEN 'panelist'  THEN 3
                WHEN 'organizer' THEN 4
                WHEN 'staff'     THEN 5
                ELSE 99
              END
              LIMIT 1
            ), 'attendee') AS role,
            e.name AS event_name
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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function detectEventFormat(eventName: string, sourcePath: string | null): EventFormat {
  const haystack = `${eventName} ${sourcePath ?? ""}`.toLowerCase();
  if (haystack.includes("webinar")) {
    return "webinar";
  }
  if (haystack.includes("conference")) {
    return "conference";
  }
  return "other";
}

function audienceForEventFormat(eventFormat: EventFormat): string {
  switch (eventFormat) {
    case "webinar":
      return "security, operations, and architecture teams";
    case "conference":
      return "practitioners, standards bodies, implementers, and decision-makers";
    default:
      return "people working on digital trust and cryptography";
  }
}

function roleToAction(role: string): string {
  switch (role) {
    case "speaker":
    case "co_speaker":
      return "is speaking at";
    case "moderator":
      return "is moderating";
    case "panelist":
      return "is a panelist at";
    case "organizer":
      return "is organizing";
    case "staff":
      return "is helping run";
    case "proposer":
      return "submitted a proposal for";
    case "attendee":
    default:
      return "is attending";
  }
}

function buildOgDescription(name: string, eventName: string, role: string, eventFormat: EventFormat): string {
  const audience = audienceForEventFormat(eventFormat);
  switch (role) {
    case "speaker":
    case "co_speaker":
      return name
        ? eventFormat === "webinar"
          ? `${name} is speaking in ${eventName} to share practical guidance with ${audience}. Join live online to get the takeaways first-hand.`
          : `${name} is speaking at ${eventName} to share practical insight with ${audience}. Explore the speakers and schedule, then register to hear it live.`
        : eventFormat === "webinar"
          ? `Join ${eventName} live online to hear practical guidance for ${audience}. Register now to see whether it fits your team's next step.`
          : `Explore ${eventName}'s speakers and schedule, then register to hear the sessions live and compare notes with ${audience}.`;
    case "moderator":
      return name
        ? eventFormat === "webinar"
          ? `${name} is moderating ${eventName} to keep the session focused on practical takeaways for ${audience}. Join live online to follow the conversation.`
          : `${name} is moderating ${eventName} to guide the conversation for ${audience}. Explore the program, then register to be there.`
        : eventFormat === "webinar"
          ? `Join ${eventName} live online for a focused conversation designed for ${audience}. Register to see the discussion first-hand.`
          : `Explore ${eventName}'s program, then register to be part of the conversation and compare notes with ${audience}.`;
    case "panelist":
      return name
        ? eventFormat === "webinar"
          ? `${name} is a panelist in ${eventName}, bringing real-world perspective to a live discussion for ${audience}. Join online to hear what they are saying.`
          : `${name} is a panelist at ${eventName}, bringing real-world perspective to a discussion that matters to teams planning the next move. Explore the panel and schedule, then register to be there.`
        : eventFormat === "webinar"
          ? `Explore ${eventName}'s panel sessions and register to hear the discussion live online with ${audience}.`
          : `Explore ${eventName}'s panel sessions and schedule, then register to hear the discussion live and compare notes with ${audience}.`;
    case "organizer":
      return name
        ? eventFormat === "webinar"
          ? `${name} is organizing ${eventName} to make practical guidance easy to access for ${audience}. Join live online to see the session come together.`
          : `${name} is organizing ${eventName} to bring ${audience} together around practical progress. Explore the program, then register to join them.`
        : eventFormat === "webinar"
          ? `Join ${eventName} live online for practical guidance shaped for ${audience}. Register to take part from wherever you are.`
          : `Explore ${eventName} and register to join ${audience} around practical progress.`;
    case "staff":
      return name
        ? eventFormat === "webinar"
          ? `${name} is helping run ${eventName}, making the live session work smoothly for everyone online. Explore the program, then register to be part of it.`
          : `${name} is helping run ${eventName}, making the event happen behind the scenes for ${audience}. Explore the program, then register to be part of it.`
        : eventFormat === "webinar"
          ? `Explore ${eventName} and register to join a live session built for ${audience}.`
          : `Explore ${eventName} and register to take part in the event the team is making happen behind the scenes.`;
    case "proposer":
      return name
        ? eventFormat === "webinar"
          ? `${name} submitted a proposal for ${eventName} to shape a session with ideas useful to ${audience}. Explore the speakers and register to see the result live.`
          : `${name} submitted a proposal for ${eventName} to shape the program with ideas useful to ${audience}. Explore the speakers and schedule, then register to follow the discussion.`
        : eventFormat === "webinar"
          ? `Explore ${eventName}'s speakers and register to follow the discussion and see practical ideas come together live.`
          : `Explore ${eventName}'s speakers and schedule, then register to follow the discussion and see the ideas taking shape across the field.`;
    case "attendee":
    default:
      return name
        ? eventFormat === "webinar"
          ? `${name} is attending ${eventName} to get practical guidance without travel and decide whether it fits their team. Explore the speakers and register to join live online.`
          : `${name} is attending ${eventName} to learn, connect, and compare notes with ${audience}. Explore the speakers and schedule, then register to join them.`
        : eventFormat === "webinar"
          ? `Join ${eventName} live online to get practical guidance quickly and decide whether it fits your team. Register now to hear it first-hand.`
          : `Attend ${eventName} to learn from the speakers, meet ${audience}, and take part in conversations that matter. Register today at pkic.org.`;
  }
}

function buildOgImageAlt(name: string, eventName: string, role: string, eventFormat: EventFormat): string {
  const action = roleToAction(role);
  const formatLabel = eventFormat === "webinar" ? "webinar" : eventFormat === "conference" ? "conference" : "event";
  return name
    ? `${name} ${action} ${eventName} on a personalized PKI Consortium ${formatLabel} card.`
    : `Personalized PKI Consortium ${formatLabel} card for ${eventName}.`;
}

function buildOgHtml(
  code: string,
  appBaseUrl: string,
  redirectUrl: string,
  person: OgPersonRow | null,
  eventFormat: EventFormat,
  ogImageType: string,
): string {
  const name = person ? `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() : "";
  const eventName = person?.event_name ?? "PKI Consortium Event";
  const role = person?.role ?? "attendee";
  const action = person ? roleToAction(role) : "is attending";

  const ogTitle = name ? `${escapeHtml(name)} ${escapeHtml(action)} ${escapeHtml(eventName)}` : escapeHtml(eventName);
  const ogDescription = escapeHtml(buildOgDescription(name, eventName, role, eventFormat));
  const ogImageAlt = escapeHtml(buildOgImageAlt(name, eventName, role, eventFormat));

  const ogImage = `${appBaseUrl}/api/v1/og/${encodeURIComponent(code)}`;
  const ogUrl = `${appBaseUrl}/r/${encodeURIComponent(code)}`;
  const canonical = escapeHtml(redirectUrl);
  const ogImageEsc = escapeHtml(ogImage);
  const ogUrlEsc = escapeHtml(ogUrl);

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
  <meta property="og:image:type"  content="${ogImageType}">
  <meta property="og:image:alt"   content="${ogImageAlt}">
  <meta property="og:site_name"   content="PKI Consortium">

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${ogTitle}">
  <meta name="twitter:description" content="${ogDescription}">
  <meta name="twitter:image"       content="${ogImageEsc}">
  <meta name="twitter:image:alt"   content="${ogImageAlt}">

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
</body>
</html>`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function onRequestGet(c: any): Promise<Response> {
  const signingSecret = requireInternalSecret(c.env);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const code = c.req.param("code");
  const userAgent = getUserAgent(c.req.raw);

  // ── Validate the code exists and get its event_id ─────────────────────────
  const refRow = await first<{ event_id: string }>(c.env.DB, "SELECT event_id FROM referral_codes WHERE code = ?", [
    code,
  ]);

  if (!refRow) {
    return json({ error: { code: "REFERRAL_NOT_FOUND", message: "Unknown referral code" } }, 404);
  }

  // ── For real browsers, record the click (fire-and-forget) ─────────────────
  // Scrapers are excluded so they don't inflate click counts.
  if (!isSocialScraper(userAgent)) {
    void recordReferralClick(c.env.DB, {
      code,
      ip: getClientIp(c.req.raw),
      userAgent,
      secret: signingSecret,
    }).catch(() => {
      /* ignore */
    });
  }

  // ── Resolve redirect URL and person data in parallel ──────────────────────
  const [eventRow, person] = await Promise.all([
    first<{
      name: string;
      slug: string;
      base_path: string | null;
      starts_at: string | null;
      source_path: string | null;
      settings_json: string;
    }>(c.env.DB, "SELECT name, slug, base_path, starts_at, source_path, settings_json FROM events WHERE id = ?", [
      refRow.event_id,
    ]),
    lookupOgPerson(c.env.DB, code),
  ]);

  const eventName = person?.event_name ?? eventRow?.name ?? "PKI Consortium Event";
  const eventFormat = detectEventFormat(eventName, eventRow?.source_path ?? null);

  const redirectUrl = eventRow
    ? registrationPageUrl(appBaseUrl, eventRow, { ref: code, source: "referral_link" })
    : `${appBaseUrl}/events/`;
  const ogImageType = resolveOgImageType(c.env);

  return new Response(buildOgHtml(code, appBaseUrl, redirectUrl, person, eventFormat, ogImageType), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
