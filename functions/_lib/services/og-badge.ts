/** Donation-specific social artwork. Event previews use the shared promotion scene renderer. */
import { pkiConsortiumLogo, pkiIconColor, WATERMARK_BOX, WATERMARK_SHIFT } from "./og-badge-marks";

const PKI_GREEN = "#198754"; // $green
const PKI_TEAL = "#20c997"; // $teal
const PKI_BLUE = "#5a9bd5"; // $blue
const PKI_YELLOW = "#ffc000"; // $yellow
const PKI_ORANGE = "#ed7d31"; // $orange
const PKI_RED = "#dc3545"; // $red

// Background matches pkic-og.png dark slate
const BG = "#0f1923";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
 * Consortium donation artwork: palette, fonts, rainbow stripes,
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
