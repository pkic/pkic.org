/**
 * OG Social Badge Generator
 *
 * Generates personalised SVG social-sharing badges (1200×630 px) for event
 * attendees, speakers, moderators, and other participants.
 *
 * Visual style follows the PKI Consortium website exactly:
 *   Background  #0f1923  (dark slate, matches pkic-og.png)
 *   Gradient    green → teal → blue → yellow → orange → red
 *               (exact $scss colors from the footer border-image)
 *   Font        Roboto (loaded via fontBuffers in the OG endpoint)
 *
 * Top AND bottom edges carry the full rainbow gradient so the brand accent
 * is visible even when social platforms crop the image from either side.
 *
 * The SVG is rasterised to PNG by the OG endpoint before being served and
 * cached in R2, ensuring every social network (incl. Twitter/X) receives a
 * format they support.
 */

import { zonedDatePart } from "../../../assets/shared/timezone";
import type { SocialBadgeRole } from "../../../assets/shared/schemas/participant-roles";
import { pkiConsortiumLogo, pkiIconColor, WATERMARK_BOX, WATERMARK_SHIFT } from "./og-badge-marks";

/** Role displayed on the badge for a referral code owner. */
export type BadgeRole = SocialBadgeRole;

/** Data required to render a badge. */
export interface BadgeData {
  firstName: string;
  lastName: string;
  role: BadgeRole;
  eventName: string;
  /** ISO 8601 date string, UTC */
  startsAt: string | null;
  /** ISO 8601 date string, UTC */
  endsAt: string | null;
  /** The event's place as `formatEventPlace` composes it, e.g. "Amsterdam, Netherlands" */
  location?: string | null;
  /** Organization / company name */
  organization?: string | null;
  /** Job title */
  jobTitle?: string | null;
  /**
   * Base64 data URL of the user's headshot, e.g. "data:image/jpeg;base64,..."
   * When provided, a circular photo is rendered on the right of the badge.
   */
  headshotDataUrl?: string | null;
  /**
   * Base64 data URL of the event hero/banner image.
   * When provided, rendered as a faded background behind the badge content.
   */
  heroImageDataUrl?: string | null;
}

// ─── Exact website palette (from _theme-and-bootstrap.scss) ─────────────────

const PKI_GREEN = "#198754"; // $green
const PKI_TEAL = "#20c997"; // $teal
const PKI_BLUE = "#5a9bd5"; // $blue
const PKI_YELLOW = "#ffc000"; // $yellow
const PKI_ORANGE = "#ed7d31"; // $orange
const PKI_RED = "#dc3545"; // $red

// Background matches pkic-og.png dark slate
const BG = "#0f1923";

interface RoleStyle {
  accent: string;
  action: string;
  chip: string;
}

const ROLE_STYLES: Record<BadgeRole, RoleStyle> = {
  attendee: { accent: PKI_BLUE, action: "is attending", chip: "Attendee" },
  sponsor: { accent: PKI_BLUE, action: "is sponsoring", chip: "Sponsor" },
  speaker: { accent: PKI_YELLOW, action: "is speaking at", chip: "Speaker" },
  co_speaker: { accent: PKI_YELLOW, action: "is speaking at", chip: "Speaker" },
  moderator: { accent: PKI_RED, action: "is moderating", chip: "Moderator" },
  panelist: { accent: PKI_RED, action: "is a panelist at", chip: "Panelist" },
  organizer: { accent: PKI_ORANGE, action: "is an organizer", chip: "Organizer" },
  staff: { accent: PKI_GREEN, action: "is on the team", chip: "Staff" },
  proposer: { accent: PKI_TEAL, action: "submitted a proposal", chip: "Proposer" },
};

// ─── Date formatting ─────────────────────────────────────────────────────────

function formatDateRange(startsAt: string | null, endsAt: string | null, timeZone = "UTC"): string {
  if (!startsAt) return "";

  const fmt = (d: Date, part: "day" | "month" | "year") => zonedDatePart(d, timeZone, part);

  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;

  const startDay = fmt(start, "day");
  const startMonth = fmt(start, "month");
  const startYear = fmt(start, "year");

  if (!end) return `${startMonth} ${startDay}, ${startYear}`;

  const endDay = fmt(end, "day");
  const endMonth = fmt(end, "month");
  const endYear = fmt(end, "year");

  if (startYear !== endYear) {
    return `${startMonth} ${startDay}, ${startYear} – ${endMonth} ${endDay}, ${endYear}`;
  }
  if (startMonth !== endMonth) {
    return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${startYear}`;
  }
  return `${startMonth} ${startDay}–${endDay}, ${startYear}`;
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clampText(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Choose a font size so the full name fits within the available column width.
 * contentMaxX is the right edge of the text column (60px left margin subtracted).
 */
function nameFontSize(fullName: string, contentMaxX: number): number {
  const budget = contentMaxX - 60;
  const len = fullName.length;
  // Rough px-per-char for Roboto Bold at each size
  if (len * 50 <= budget) return 84;
  if (len * 43 <= budget) return 72;
  if (len * 37 <= budget) return 62;
  if (len * 31 <= budget) return 52;
  return 44;
}

// ─── PKI Consortium logo (from static/img/logo.svg) ──────────────────────────

// ─── Badge renderer ───────────────────────────────────────────────────────────

/**
 * Generates a 1200×630 SVG badge matching the PKI Consortium website style.
 *
 * Design principles:
 *   - Hero image covers the FULL card with a dark gradient overlay, just like
 *     the website hero sections (bg-dark bg-opacity-50). Falls back to a 135°
 *     dark gradient when no hero image is available.
 *   - Bottom bar is solid black (#000) matching the website footer.
 *   - Safe zone: social platforms (Twitter/X, LinkedIn, Facebook, WhatsApp)
 *     crop OG images 5–15 % from edges. All critical text and content stays
 *     within 120 px of left/right and 63 px of top/bottom (10 % inset).
 *   - Rainbow gradient stripes on top and bottom for brand accent.
 *
 * Roboto font is required; load fontBuffers via the endpoint before calling
 * resvg so text renders correctly.
 */
export function renderBadgeSvg(data: BadgeData): string {
  const style = ROLE_STYLES[data.role] ?? ROLE_STYLES.attendee;
  const hasPhoto = Boolean(data.headshotDataUrl);
  const hasHero = Boolean(data.heroImageDataUrl);

  const W = 1200;
  const H = 630;
  const STRIPE_H = 6; // rainbow stripe height

  // ── Safe zone (10 % inset from all edges) ──────────────────────────────
  // Platforms crop differently:
  //   Facebook:  ~4 % all around
  //   Twitter/X: up to 15 % top+bottom on some views
  //   LinkedIn:  ~5 %
  //   WhatsApp:  ~5 %
  // We use 10 % as a good middle ground for critical content.
  const SAFE_L = 120; // 10 % of 1200
  const SAFE_R = W - 120;
  const SAFE_T = 63; // 10 % of 630

  // ── Bottom branding bar (solid black like website footer) ──────────────
  const BRAND_H = 56;
  const BRAND_TOP = H - STRIPE_H - BRAND_H;

  // ── Text column — leaves room for headshot when present ────────────────
  const TEXT_R = hasPhoto ? 720 : SAFE_R;

  // ── Prepare text ───────────────────────────────────────────────────────
  const fullName = `${data.firstName} ${data.lastName}`.trim();
  const nameSize = nameFontSize(fullName, TEXT_R);
  const dateStr = formatDateRange(data.startsAt, data.endsAt);
  const eventName = escapeXml(clampText(data.eventName, 50));
  const personName = escapeXml(fullName);
  const actionStr = escapeXml(style.action);
  const chipLabel = escapeXml(style.chip);
  const locationStr = data.location ? escapeXml(data.location) : "";
  const dateEsc = escapeXml(dateStr);
  const orgStr = data.organization ? escapeXml(clampText(data.organization, 40)) : "";
  const titleStr = data.jobTitle ? escapeXml(clampText(data.jobTitle, 40)) : "";

  // Build subtitle line: "Job Title · Organization" or just one
  const subtitleParts: string[] = [];
  if (titleStr) subtitleParts.push(titleStr);
  if (orgStr) subtitleParts.push(orgStr);
  const subtitle = subtitleParts.join(" · ");

  // ── Event info (top of safe zone) ──────────────────────────────────────
  const EVENT_SIZE = 26;
  const META_SIZE = 15;

  // Event date + location line
  const metaParts: string[] = [];
  if (dateEsc) metaParts.push(dateEsc);
  if (locationStr) metaParts.push(locationStr);
  const metaLine = metaParts.join("  ·  ");

  // ── Role chip — upper-right in safe zone ───────────────────────────────
  const chipPadX = 18;
  const chipCharW = 8;
  const chipW = Math.round(chipLabel.length * chipCharW + chipPadX * 2);
  const chipX = SAFE_R - chipW;
  const chipY = SAFE_T;
  const chipH = 28;

  // ── Person area — vertically centered between event info and brand bar ──
  const personAreaTop = SAFE_T + EVENT_SIZE + 10 + META_SIZE + 40;
  const personAreaBottom = BRAND_TOP - 20;
  const personAreaMid = Math.round((personAreaTop + personAreaBottom) / 2);

  // Stack: name + subtitle + action — centered vertically
  const GAP_SUB = 8;
  const GAP_ACTION = 14;
  const SUB_SIZE = 20;
  const ACTION_SIZE = 22;
  const totalStack = nameSize + (subtitle ? GAP_SUB + SUB_SIZE : 0) + GAP_ACTION + ACTION_SIZE;
  const stackTop = personAreaMid - Math.round(totalStack / 2);

  const nameY = stackTop + nameSize;
  const subY = subtitle ? nameY + GAP_SUB + SUB_SIZE : nameY;
  const actionY = subY + GAP_ACTION + ACTION_SIZE;

  // ── Headshot circle — centered in person area, right side ───────────────
  const HS_CX = 960;
  const HS_CY = personAreaMid;
  const HS_R = Math.min(110, Math.round((personAreaBottom - personAreaTop) / 2 - 10));

  // ── Watermark — large PKI icon, faint color ──────────────────────────
  const wmH = WATERMARK_BOX;
  const wmX = (hasPhoto ? 680 : 780) - WATERMARK_SHIFT;
  const wmY = Math.round(personAreaMid - wmH / 2);

  // ── Bottom branding ────────────────────────────────────────────────────
  const LOGO_H = 34;
  const logoY = BRAND_TOP + Math.round((BRAND_H - LOGO_H) / 2);

  // ── CTA pill (psychology: personal invitation + button affordance) ──────
  // "Join me, register now!" activates mimetic desire (the sharer is the
  // social proof) + present-bias urgency ("now"). Solid green = action color.
  // The pill shape primes click behavior in a static image (button affordance).
  // Arrow drawn as SVG path — Unicode arrows are not in Roboto so fall back to
  // a box glyph; a path always renders correctly.
  const PILL_H = LOGO_H; // matches logo height (34)
  const PILL_W = 248;
  const PILL_X = SAFE_R - PILL_W;
  const PILL_Y = logoY;
  const PILL_CY = PILL_Y + Math.round(PILL_H / 2);
  const PILL_TX = PILL_X + Math.round(PILL_W / 2) - 10; // slightly left of center — room for arrow
  const PILL_TY = PILL_CY + 5; // baseline
  // Arrow drawn as SVG path — a proper right-pointing arrow (→) with line
  // and arrowhead, not a chevron. Centered vertically in the pill.
  const ARW_X = PILL_X + PILL_W - 30;
  const ARW_CY = PILL_CY;

  const FONT = "Roboto";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     role="img" aria-label="${personName} ${actionStr} ${eventName}">

  <defs>
    <linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${PKI_GREEN}"/>
      <stop offset="20%"  stop-color="${PKI_TEAL}"/>
      <stop offset="40%"  stop-color="${PKI_BLUE}"/>
      <stop offset="60%"  stop-color="${PKI_YELLOW}"/>
      <stop offset="80%"  stop-color="${PKI_ORANGE}"/>
      <stop offset="100%" stop-color="${PKI_RED}"/>
    </linearGradient>
    <linearGradient id="fadeDown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${BG}" stop-opacity="0"/>
      <stop offset="40%"  stop-color="${BG}" stop-opacity="0.25"/>
      <stop offset="70%"  stop-color="${BG}" stop-opacity="0.70"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="1"/>
    </linearGradient>
    ${hasPhoto ? `<clipPath id="hsClip"><circle cx="${HS_CX}" cy="${HS_CY}" r="${HS_R}"/></clipPath>` : ""}
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- ═══ FULL-BLEED HERO IMAGE / GRADIENT ═══ -->
  ${
    hasHero
      ? `<!-- Hero image covers full card -->
  <image href="${data.heroImageDataUrl}" x="0" y="0" width="${W}" height="${H}"
         preserveAspectRatio="xMidYMid slice"/>
  <!-- Dark overlay (matches website bg-dark bg-opacity-50) -->
  <rect width="${W}" height="${H}" fill="#000" opacity="0.20"/>
  <!-- Bottom fade to BG for readability -->
  <rect width="${W}" height="${H}" fill="url(#fadeDown)"/>`
      : `<!-- No hero — solid dark background (already set above) -->`
  }

  <!-- ═══ EVENT INFO (top of safe zone) ═══ -->

  <!-- Event name -->
  <text x="${SAFE_L}" y="${SAFE_T + EVENT_SIZE}"
        font-family="${FONT}" font-size="${EVENT_SIZE}" font-weight="700"
        fill="#ffffff">${eventName}</text>

  <!-- Event date + location -->
  ${
    metaLine
      ? `<text x="${SAFE_L}" y="${SAFE_T + EVENT_SIZE + 8 + META_SIZE}"
        font-family="${FONT}" font-size="${META_SIZE}" font-weight="400"
        fill="rgba(255,255,255,0.65)">${escapeXml(metaLine)}</text>`
      : ""
  }

  <!-- Role chip -->
  <rect x="${chipX}" y="${chipY}" width="${chipW}" height="${chipH}" rx="${chipH / 2}"
        fill="${style.accent}"/>
  <text x="${chipX + chipW / 2}" y="${chipY + chipH / 2 + 4.5}"
        font-family="${FONT}" font-size="12" font-weight="700"
        fill="#ffffff" text-anchor="middle" letter-spacing="0.6">${chipLabel}</text>

  <!-- ═══ PERSON CONTENT ═══ -->

  <!-- PKI watermark -->
  <g opacity="0.04">${pkiIconColor(wmX, wmY, wmH)}</g>

  <!-- Person name -->
  <text x="${SAFE_L}" y="${nameY}"
        font-family="${FONT}" font-size="${nameSize}" font-weight="700"
        fill="#ffffff" letter-spacing="-0.5">${personName}</text>

  ${
    subtitle
      ? `<!-- Organization / Job title -->
  <text x="${SAFE_L}" y="${subY}"
        font-family="${FONT}" font-size="${SUB_SIZE}" font-weight="400"
        fill="rgba(255,255,255,0.55)">${escapeXml(subtitle)}</text>`
      : ""
  }

  <!-- Action phrase -->
  <text x="${SAFE_L}" y="${actionY}"
        font-family="${FONT}" font-size="${ACTION_SIZE}" font-weight="400"
        fill="${style.accent}">${actionStr}</text>

  ${
    hasPhoto
      ? `<!-- Headshot -->
  <circle cx="${HS_CX}" cy="${HS_CY}" r="${HS_R + 3}" fill="#ffffff" opacity="0.15"/>
  <image href="${data.headshotDataUrl}" x="${HS_CX - HS_R}" y="${HS_CY - HS_R}"
         width="${HS_R * 2}" height="${HS_R * 2}"
         clip-path="url(#hsClip)" preserveAspectRatio="xMidYMid slice"/>
  <circle cx="${HS_CX}" cy="${HS_CY}" r="${HS_R}"
          fill="none" stroke="#ffffff" stroke-width="2"/>`
      : ""
  }

  <!-- ═══ BOTTOM BAR (solid black like website footer) ═══ -->
  <rect x="0" y="${BRAND_TOP}" width="${W}" height="${BRAND_H + STRIPE_H}" fill="#000"/>

  <!-- PKI Consortium full logo (white) -->
  <g opacity="0.85">${pkiConsortiumLogo(SAFE_L, logoY, LOGO_H)}</g>

  <!-- CTA pill — solid green action button, SVG arrow, personal invitation -->
  <rect x="${PILL_X}" y="${PILL_Y}" width="${PILL_W}" height="${PILL_H}" rx="${Math.round(PILL_H / 2)}"
        fill="${PKI_GREEN}"/>
  <text x="${PILL_TX}" y="${PILL_TY}"
        font-family="${FONT}" font-size="14" font-weight="700"
        fill="#ffffff" text-anchor="middle">Join me, register now!</text>
  <line x1="${ARW_X - 2}" y1="${ARW_CY}" x2="${ARW_X + 12}" y2="${ARW_CY}"
        stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
  <path d="M ${ARW_X + 7},${ARW_CY - 5} L ${ARW_X + 13},${ARW_CY} L ${ARW_X + 7},${ARW_CY + 5}"
        fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- ═══ RAINBOW STRIPES (decorative, outside safe zone — OK to crop) ═══ -->
  <rect y="0" width="${W}" height="${STRIPE_H}" fill="url(#rainbow)"/>
  <rect y="${H - STRIPE_H}" width="${W}" height="${STRIPE_H}" fill="url(#rainbow)"/>

</svg>`;
}

// ─── Donation badge ───────────────────────────────────────────────────────────

export interface DonationBadgeData {
  /** Donor's first name (or full name when only one token is available). */
  firstName: string;
  lastName?: string | null;
  /** Already-formatted amount string, e.g. "$100" or "€1,250". */
  formattedAmount: string;
}

/**
 * Generates a 1200×630 SVG donation badge.
 *
 * Visual sibling of renderBadgeSvg — same palette, fonts, rainbow stripes,
 * PKI logo bottom bar, and watermark. Content is donation-specific:
 *   [Name]  (large white, top of content area)
 *   donated  (muted)
 *   [Amount]  (huge, orange)
 *   to the PKI Consortium  (white)
 *   to support free and open PKI events  (muted caption)
 *
 * CTA pill: "Match this donation!"  (green, bottom bar)
 */
export function renderDonationBadgeSvg(data: DonationBadgeData): string {
  const W = 1200;
  const H = 630;
  const STRIPE_H = 6;

  const SAFE_L = 120;
  const SAFE_R = W - 120;
  const SAFE_T = 63;

  const BRAND_H = 56;
  const BRAND_TOP = H - STRIPE_H - BRAND_H;

  // ── Text ──────────────────────────────────────────────────────────────────
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || "A supporter";
  const nameSize = nameFontSize(fullName, SAFE_R);
  const nameEsc = escapeXml(fullName);
  const amountEsc = escapeXml(data.formattedAmount);

  // ── Chip ──────────────────────────────────────────────────────────────────
  const chipLabel = "Supporter";
  const chipPadX = 18;
  const chipCharW = 8;
  const chipW = Math.round(chipLabel.length * chipCharW + chipPadX * 2);
  const chipX = SAFE_R - chipW;
  const chipH = 28;

  // ── Content area — below chip row to above brand bar ─────────────────────
  const personAreaTop = SAFE_T + chipH + 20;
  const personAreaBottom = BRAND_TOP - 20;
  const personAreaMid = Math.round((personAreaTop + personAreaBottom) / 2);

  // ── Vertical stack ────────────────────────────────────────────────────────
  const GAP_S = 8;
  const GAP_M = 14;
  const ACT_SIZE = 22; // "donated"
  const AMT_SIZE = 96; // amount — hero number
  const CTX_SIZE = 26; // "to the PKI Consortium"
  const SUB_SIZE = 18; // caption

  const totalStack = nameSize + GAP_S + ACT_SIZE + GAP_M + AMT_SIZE + GAP_S + CTX_SIZE + GAP_S + SUB_SIZE;
  const stackTop = personAreaMid - Math.round(totalStack / 2);

  const nameY = stackTop + nameSize;
  const actY = nameY + GAP_S + ACT_SIZE;
  const amtY = actY + GAP_M + AMT_SIZE;
  const ctxY = amtY + GAP_S + CTX_SIZE;
  const subY = ctxY + GAP_S + SUB_SIZE;

  // ── Bottom bar ────────────────────────────────────────────────────────────
  const LOGO_H = 34;
  const logoY = BRAND_TOP + Math.round((BRAND_H - LOGO_H) / 2);

  // ── CTA pill ──────────────────────────────────────────────────────────────
  const PILL_H = LOGO_H;
  const PILL_W = 260;
  const PILL_X = SAFE_R - PILL_W;
  const PILL_Y = logoY;
  const PILL_CY = PILL_Y + Math.round(PILL_H / 2);
  const PILL_TX = PILL_X + Math.round(PILL_W / 2) - 10;
  const PILL_TY = PILL_CY + 5;
  const ARW_X = PILL_X + PILL_W - 30;
  const ARW_CY = PILL_CY;

  // ── Watermark ─────────────────────────────────────────────────────────────
  const wmH = WATERMARK_BOX;
  const wmY = Math.round(personAreaMid - wmH / 2);

  const FONT = "Roboto";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     role="img" aria-label="${nameEsc} donated ${amountEsc} to the PKI Consortium">

  <defs>
    <linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="${PKI_GREEN}"/>
      <stop offset="20%"  stop-color="${PKI_TEAL}"/>
      <stop offset="40%"  stop-color="${PKI_BLUE}"/>
      <stop offset="60%"  stop-color="${PKI_YELLOW}"/>
      <stop offset="80%"  stop-color="${PKI_ORANGE}"/>
      <stop offset="100%" stop-color="${PKI_RED}"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- Supporter chip -->
  <rect x="${chipX}" y="${SAFE_T}" width="${chipW}" height="${chipH}" rx="${chipH / 2}"
        fill="${PKI_ORANGE}"/>
  <text x="${chipX + chipW / 2}" y="${SAFE_T + chipH / 2 + 4.5}"
        font-family="${FONT}" font-size="12" font-weight="700"
        fill="#ffffff" text-anchor="middle" letter-spacing="0.6">${chipLabel}</text>

  <!-- Faint PKI watermark -->
  <g opacity="0.04">${pkiIconColor(780 - WATERMARK_SHIFT, wmY, wmH)}</g>

  <!-- Name -->
  <text x="${SAFE_L}" y="${nameY}"
        font-family="${FONT}" font-size="${nameSize}" font-weight="700"
        fill="#ffffff" letter-spacing="-0.5">${nameEsc}</text>

  <!-- "donated" -->
  <text x="${SAFE_L}" y="${actY}"
        font-family="${FONT}" font-size="${ACT_SIZE}" font-weight="400"
        fill="rgba(255,255,255,0.55)">donated</text>

  <!-- Amount — hero number -->
  <text x="${SAFE_L}" y="${amtY}"
        font-family="${FONT}" font-size="${AMT_SIZE}" font-weight="700"
        fill="${PKI_ORANGE}" letter-spacing="-1">${amountEsc}</text>

  <!-- "to the PKI Consortium" -->
  <text x="${SAFE_L}" y="${ctxY}"
        font-family="${FONT}" font-size="${CTX_SIZE}" font-weight="400"
        fill="#ffffff">to the PKI Consortium</text>

  <!-- Caption -->
  <text x="${SAFE_L}" y="${subY}"
        font-family="${FONT}" font-size="${SUB_SIZE}" font-weight="400"
        fill="rgba(255,255,255,0.55)">to keep our memberships, resources, and events free</text>

  <!-- ═══ BOTTOM BAR ═══ -->
  <rect x="0" y="${BRAND_TOP}" width="${W}" height="${BRAND_H + STRIPE_H}" fill="#000"/>

  <!-- PKI Consortium full logo (white) -->
  <g opacity="0.85">${pkiConsortiumLogo(SAFE_L, logoY, LOGO_H)}</g>

  <!-- CTA pill: "Match this donation!" -->
  <rect x="${PILL_X}" y="${PILL_Y}" width="${PILL_W}" height="${PILL_H}" rx="${Math.round(PILL_H / 2)}"
        fill="${PKI_GREEN}"/>
  <text x="${PILL_TX}" y="${PILL_TY}"
        font-family="${FONT}" font-size="14" font-weight="700"
        fill="#ffffff" text-anchor="middle">Match this donation!</text>
  <line x1="${ARW_X - 2}" y1="${ARW_CY}" x2="${ARW_X + 12}" y2="${ARW_CY}"
        stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
  <path d="M ${ARW_X + 7},${ARW_CY - 5} L ${ARW_X + 13},${ARW_CY} L ${ARW_X + 7},${ARW_CY + 5}"
        fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- ═══ RAINBOW STRIPES ═══ -->
  <rect y="0" width="${W}" height="${STRIPE_H}" fill="url(#rainbow)"/>
  <rect y="${H - STRIPE_H}" width="${W}" height="${STRIPE_H}" fill="url(#rainbow)"/>

</svg>`;
}
