/**
 * OG Social Badge Generator
 *
 * Generates personalised SVG social-sharing badges (1200×630 px) for event
 * attendees, speakers, moderators, and other participants.
 *
 * Visual style follows the PKI Consortium website exactly:
 *   Background  #0f1923  (dark slate, matches pkic-og.png)
 *   Gradient    green → teal → blue → yellow → orange → red
 *               (exact $scss colours from the footer border-image)
 *   Font        Roboto (loaded via fontBuffers in the OG endpoint)
 *
 * Top AND bottom edges carry the full rainbow gradient so the brand accent
 * is visible even when social platforms crop the image from either side.
 *
 * The SVG is rasterised to PNG by the OG endpoint before being served and
 * cached in R2, ensuring every social network (incl. Twitter/X) receives a
 * format they support.
 */

/** Role displayed on the badge for a referral code owner. */
export type BadgeRole =
  | "attendee"
  | "speaker"
  | "co_speaker"
  | "moderator"
  | "panelist"
  | "organizer"
  | "staff"
  | "proposer";

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
  /** Optional location label, e.g. "Amsterdam, The Netherlands" */
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

const PKI_GREEN  = "#198754"; // $green
const PKI_TEAL   = "#20c997"; // $teal
const PKI_BLUE   = "#5a9bd5"; // $blue
const PKI_YELLOW = "#ffc000"; // $yellow
const PKI_ORANGE = "#ed7d31"; // $orange
const PKI_RED    = "#dc3545"; // $red

// Background matches pkic-og.png dark slate
const BG = "#0f1923";

interface RoleStyle {
  accent: string;
  action: string;
  chip: string;
}

const ROLE_STYLES: Record<BadgeRole, RoleStyle> = {
  attendee:  { accent: PKI_BLUE,   action: "is attending",    chip: "Attendee"  },
  speaker:   { accent: PKI_YELLOW, action: "is speaking at",  chip: "Speaker"   },
  co_speaker:{ accent: PKI_YELLOW, action: "is speaking at",  chip: "Speaker"   },
  moderator: { accent: PKI_RED,    action: "is moderating",   chip: "Moderator" },
  panelist:  { accent: PKI_RED,    action: "is a panelist at", chip: "Panelist" },
  organizer: { accent: PKI_ORANGE, action: "is an organizer", chip: "Organizer" },
  staff:     { accent: PKI_GREEN,  action: "is on the team",  chip: "Staff"     },
  proposer:  { accent: PKI_TEAL,   action: "submitted a proposal", chip: "Proposer" },
};

// ─── Date formatting ─────────────────────────────────────────────────────────

function formatDateRange(
  startsAt: string | null,
  endsAt: string | null,
  timeZone = "UTC",
): string {
  if (!startsAt) return "";

  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(d);

  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;

  const startDay   = fmt(start, { day: "numeric" });
  const startMonth = fmt(start, { month: "long" });
  const startYear  = fmt(start, { year: "numeric" });

  if (!end) return `${startMonth} ${startDay}, ${startYear}`;

  const endDay   = fmt(end, { day: "numeric" });
  const endMonth = fmt(end, { month: "long" });
  const endYear  = fmt(end, { year: "numeric" });

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
  const len    = fullName.length;
  // Rough px-per-char for Roboto Bold at each size
  if (len * 50 <= budget) return 84;
  if (len * 43 <= budget) return 72;
  if (len * 37 <= budget) return 62;
  if (len * 31 <= budget) return 52;
  return 44;
}

// ─── PKI Consortium logo (from static/img/logo.svg) ──────────────────────────

/**
 * Full PKI Consortium logo (icon + wordmark) from static/img/logo.svg.
 * viewBox 0 0 1256 324. All paths are white (class shp0).
 * The SVG is embedded inline so resvg can render it without external fetches.
 */
function pkiConsortiumLogo(x: number, y: number, height: number): string {
  const s = height / 324;
  return `<g transform="translate(${x}, ${y}) scale(${s.toFixed(6)})">
    <path fill="#fff" d="M441.5 165.63L441.5 17.7L560.02 17.7C568.04 17.7 575.03 20.58 581 26.34C586.76 32.3 589.64 39.3 589.64 47.32L589.64 86.41C589.64 94.44 586.76 101.23 581 106.99C575.03 112.96 568.04 115.84 560.02 115.84L471.13 116.05L471.13 165.63L441.5 165.63ZM477.92 86.21L552.81 86.21C556.93 86.21 559.19 86.01 559.4 85.8C559.6 85.59 559.81 83.33 559.81 79.21L559.81 54.11C559.81 50 559.6 47.74 559.4 47.53C559.19 47.32 556.93 47.32 552.81 47.32L477.92 47.32C473.81 47.32 471.75 47.32 471.54 47.53C471.34 47.74 471.13 50 471.13 54.11L471.13 79.21C471.13 83.33 471.34 85.59 471.54 85.8C471.75 86.01 473.81 86.21 477.92 86.21ZM634.06 165.63L634.06 17.49L663.89 17.49L663.89 76.74L695.78 76.74L745.37 17.49L776.85 17.49L776.85 26.95L722.53 91.56L776.85 156.17L776.85 165.63L745.37 165.63L695.78 106.38L663.89 106.38L663.89 165.63L634.06 165.63ZM826.62 165.63L826.62 17.49L855.84 17.49L855.84 165.63L826.62 165.63Z"/>
    <path fill="#fff" d="M457.28 306.53C452.96 306.53 449.22 305.01 446.19 301.86C443.04 298.83 441.52 295.09 441.52 290.77L441.52 238.25C441.52 233.93 443.04 230.19 446.19 227.04C449.22 224.01 452.96 222.49 457.28 222.49L525.33 222.49L525.33 236.61L459.73 236.61C457.74 236.61 456.58 236.85 456.22 237.2C455.76 237.55 455.53 238.71 455.53 240.7L455.53 288.32C455.53 290.31 455.76 291.47 456.22 291.82C456.58 292.17 457.74 292.41 459.73 292.41L525.33 292.41L525.33 306.53L457.28 306.53ZM562.2 306.53C557.88 306.53 554.27 305.01 551.23 301.86C548.08 298.83 546.56 295.21 546.56 290.89L546.56 254.47C546.56 250.15 548.08 246.53 551.23 243.38C554.27 240.35 557.88 238.83 562.2 238.83L599.67 238.83C603.99 238.83 607.73 240.35 610.76 243.38C613.79 246.53 615.31 250.15 615.31 254.47L615.31 290.89C615.31 295.21 613.79 298.83 610.76 301.86C607.73 305.01 603.99 306.53 599.67 306.53L562.2 306.53ZM564.65 292.64L597.22 292.64C599.2 292.64 600.37 292.41 600.84 291.94C601.19 291.59 601.42 290.42 601.42 288.44L601.42 256.92C601.42 254.94 601.19 253.77 600.84 253.3C600.37 252.95 599.2 252.72 597.22 252.72L564.65 252.72C562.67 252.72 561.5 252.95 561.15 253.3C560.69 253.77 560.45 254.94 560.45 256.92L560.45 288.44C560.45 290.42 560.69 291.59 561.15 291.94C561.5 292.41 562.67 292.64 564.65 292.64ZM634.79 306.53L634.79 238.83L688.02 238.83C692.34 238.83 695.96 240.35 698.99 243.38C702.03 246.53 703.54 250.15 703.54 254.47L703.54 306.53L689.65 306.53L689.65 256.92C689.65 254.94 689.42 253.77 689.07 253.3C688.6 252.95 687.44 252.72 685.45 252.72L653 252.72C651.02 252.72 649.85 252.95 649.38 253.3C648.92 253.77 648.68 254.94 648.68 256.92L648.68 306.53L634.79 306.53ZM739.37 306.53C735.05 306.53 731.43 305.01 728.4 301.86C725.24 298.83 723.73 295.21 723.73 290.89L723.73 288.67L737.62 288.67L737.62 289.49C737.62 290.77 737.85 291.59 738.32 291.94C738.67 292.41 739.49 292.64 740.77 292.64L775.44 292.64C776.72 292.64 777.54 292.41 778.01 291.94C778.35 291.59 778.59 290.77 778.59 289.49L778.59 282.84C778.59 281.55 778.35 280.73 778.01 280.27C777.54 279.92 776.72 279.69 775.44 279.69L739.37 279.69C735.05 279.69 731.43 278.17 728.4 275.02C725.24 271.98 723.73 268.36 723.73 264.04L723.73 254.47C723.73 250.15 725.24 246.53 728.4 243.38C731.43 240.35 735.05 238.83 739.37 238.83L776.84 238.83C781.16 238.83 784.89 240.35 788.04 243.38C791.08 246.53 792.59 250.15 792.59 254.47L792.59 256.69L778.59 256.69L778.59 255.87C778.59 254.59 778.35 253.77 778.01 253.3C777.54 252.95 776.72 252.72 775.44 252.72L740.77 252.72C739.49 252.72 738.67 252.95 738.32 253.3C737.85 253.77 737.62 254.59 737.62 255.87L737.62 262.52C737.62 263.81 737.85 264.63 738.32 264.98C738.67 265.44 739.49 265.68 740.77 265.68L776.84 265.68C781.16 265.68 784.89 267.19 788.04 270.23C791.08 273.38 792.59 277 792.59 281.32L792.59 290.89C792.59 295.21 791.08 298.83 788.04 301.86C784.89 305.01 781.16 306.53 776.84 306.53L739.37 306.53ZM828.19 306.53C823.87 306.53 820.25 305.01 817.22 301.86C814.06 298.83 812.55 295.21 812.55 290.89L812.55 254.47C812.55 250.15 814.06 246.53 817.22 243.38C820.25 240.35 823.87 238.83 828.19 238.83L865.66 238.83C869.98 238.83 873.71 240.35 876.74 243.38C879.78 246.53 881.3 250.15 881.3 254.47L881.3 290.89C881.3 295.21 879.78 298.83 876.74 301.86C873.71 305.01 869.98 306.53 865.66 306.53L828.19 306.53ZM830.64 292.64L863.21 292.64C865.19 292.64 866.36 292.41 866.82 291.94C867.17 291.59 867.41 290.42 867.41 288.44L867.41 256.92C867.41 254.94 867.17 253.77 866.82 253.3C866.36 252.95 865.19 252.72 863.21 252.72L830.64 252.72C828.66 252.72 827.49 252.95 827.14 253.3C826.67 253.77 826.44 254.94 826.44 256.92L826.44 288.44C826.44 290.42 826.67 291.59 827.14 291.94C827.49 292.41 828.66 292.64 830.64 292.64ZM900.9 306.53L900.9 254.47C900.9 250.15 902.41 246.53 905.57 243.38C908.6 240.35 912.22 238.83 916.54 238.83L954.24 238.83L954.24 252.72L918.99 252.72C917.01 252.72 915.84 252.95 915.49 253.3C915.02 253.77 914.79 254.94 914.79 256.92L914.79 306.53L900.9 306.53ZM986.91 306.53C982.59 306.53 978.86 305.01 975.83 301.86C972.79 298.83 971.27 295.21 971.27 290.89L971.27 217.7L985.16 217.7L985.16 238.83L1012.24 238.83L1012.24 252.72L985.16 252.72L985.16 288.44C985.16 290.42 985.4 291.59 985.86 291.94C986.21 292.41 987.38 292.64 989.37 292.64L1012.24 292.64L1012.24 306.53L986.91 306.53ZM1031.49 306.53L1031.49 238.83L1045.38 238.83L1045.38 306.53L1031.49 306.53ZM1031.49 230.66L1031.49 216.65L1045.38 216.65L1045.38 230.66L1031.49 230.66ZM1082.49 306.53C1078.17 306.53 1074.44 305.01 1071.4 301.86C1068.36 298.83 1066.85 295.21 1066.85 290.89L1066.85 238.83L1080.74 238.83L1080.74 288.44C1080.74 290.42 1080.97 291.59 1081.44 291.94C1081.79 292.41 1082.96 292.64 1084.94 292.64L1117.51 292.64C1119.49 292.64 1120.66 292.41 1121.12 291.94C1121.47 291.59 1121.71 290.42 1121.71 288.44L1121.71 238.83L1135.6 238.83L1135.6 290.89C1135.6 295.21 1134.08 298.83 1131.05 301.86C1128.01 305.01 1124.28 306.53 1119.96 306.53L1082.49 306.53ZM1154.97 306.53L1154.97 238.83L1240.18 238.83C1244.49 238.83 1248.23 240.35 1251.26 243.38C1254.3 246.53 1255.82 250.15 1255.82 254.47L1255.82 306.53L1241.93 306.53L1241.93 256.92C1241.93 254.94 1241.69 253.77 1241.34 253.3C1240.87 252.95 1239.71 252.72 1237.72 252.72L1216.71 252.72C1214.73 252.72 1213.56 252.95 1213.21 253.3C1212.74 253.77 1212.51 254.94 1212.51 256.92L1212.51 306.53L1198.39 306.53L1198.39 256.92C1198.39 254.94 1198.15 253.77 1197.8 253.3C1197.45 252.95 1196.29 252.72 1194.3 252.72L1173.18 252.72C1171.19 252.72 1170.02 252.95 1169.67 253.3C1169.21 253.77 1168.97 254.94 1168.97 256.92L1168.97 306.53L1154.97 306.53Z"/>
    <path fill="#fff" d="M185.82 289.34C177.42 303.88 175.78 323.96 157.02 323.96C138.25 323.96 136.6 303.88 128.21 289.34C100.11 283.72 74.92 270.04 55.16 250.81L69.57 237.19C92.26 258.97 123.07 272.36 157.02 272.36C190.96 272.36 221.77 258.97 244.45 237.19L258.86 250.81C239.1 270.04 213.92 283.72 185.82 289.34Z"/>
    <path fill="#fff" d="M196.77 5.52C221.12 12.39 242.9 25.42 260.3 42.82C262.47 45 264.58 47.24 266.61 49.55C283.41 49.55 301.66 40.93 311.05 57.18C320.42 73.43 303.86 84.89 295.46 99.43C300.4 114.09 303.08 129.79 303.08 146.11C303.08 158.48 301.54 170.5 298.65 181.97L279.64 176.3C282.01 166.63 283.28 156.52 283.28 146.11C283.28 111.24 269.14 79.67 246.3 56.83C231.44 41.98 212.91 30.81 192.18 24.81L196.77 5.52Z"/>
    <path fill="#fff" d="M18.37 99.91C9.98 85.37 -6.59 73.91 2.79 57.66C12.18 41.41 30.42 50.03 47.22 50.03C49.26 47.72 51.36 45.48 53.54 43.3C70.94 25.9 92.71 12.87 117.07 6L121.66 25.29C100.93 31.29 82.39 42.46 67.54 57.31C44.7 80.15 30.56 111.72 30.56 146.59C30.56 157 31.83 167.11 34.2 176.78L15.19 182.45C12.3 170.98 10.76 158.96 10.76 146.59C10.76 130.27 13.43 114.57 18.37 99.91Z"/>
    <path fill="#fff" fill-rule="evenodd" d="M227.24 75.88C245.22 93.85 256.33 118.68 256.33 146.11C256.33 160.68 253.19 174.53 247.55 186.99L288.45 210.61L278.62 227.71L237.67 204.06C234.53 208.43 231.04 212.54 227.24 216.34C209.26 234.31 184.43 245.43 157.02 245.43C129.59 245.43 104.76 234.31 86.78 216.34C82.99 212.54 79.5 208.43 76.36 204.06L35.41 227.71L25.58 210.61L66.48 186.99C60.84 174.53 57.69 160.68 57.69 146.11C57.69 118.68 68.81 93.85 86.78 75.88C102.57 60.1 123.64 49.6 147.11 47.28L147.11 0.04L166.92 0.04L166.92 47.28C190.39 49.6 211.46 60.1 227.24 75.88ZM213.23 89.89C198.85 75.5 178.97 66.6 157.02 66.6C135.06 66.6 115.18 75.5 100.79 89.89C86.4 104.27 77.5 124.15 77.5 146.11C77.5 168.06 86.4 187.94 100.79 202.33C115.18 216.72 135.06 225.61 157.02 225.61C178.97 225.61 198.85 216.72 213.23 202.33C227.63 187.95 236.53 168.06 236.53 146.11C236.53 124.15 227.63 104.27 213.23 89.89Z"/>
    <path fill="#fff" d="M146.04 141.81L132.31 194.95L181.72 194.95L167.99 141.81C175.51 137.86 180.64 129.97 180.64 120.89C180.64 107.85 170.06 97.27 157.02 97.27C143.97 97.27 133.39 107.85 133.39 120.89C133.39 129.97 138.52 137.86 146.04 141.81Z"/>
  </g>`;
}

/** Color PKI icon only (no wordmark) for watermark. viewBox 0 0 314 324. */
function pkiIconColor(x: number, y: number, height: number): string {
  const s = height / 324;
  return `<g transform="translate(${x}, ${y}) scale(${s.toFixed(6)})">
    <path fill="#5a9bd5" d="M185.82 289.34C177.42 303.88 175.78 323.96 157.02 323.96C138.25 323.96 136.6 303.88 128.21 289.34C100.11 283.72 74.92 270.04 55.16 250.81L69.57 237.19C92.26 258.97 123.07 272.36 157.02 272.36C190.96 272.36 221.77 258.97 244.45 237.19L258.86 250.81C239.1 270.04 213.92 283.72 185.82 289.34Z"/>
    <path fill="#ed7d31" d="M196.77 5.52C221.12 12.39 242.9 25.42 260.3 42.82C262.47 45 264.58 47.24 266.61 49.55C283.41 49.55 301.66 40.93 311.05 57.18C320.42 73.43 303.86 84.89 295.46 99.43C300.4 114.09 303.08 129.79 303.08 146.11C303.08 158.48 301.54 170.5 298.65 181.97L279.64 176.3C282.01 166.63 283.28 156.52 283.28 146.11C283.28 111.24 269.14 79.67 246.3 56.83C231.44 41.98 212.91 30.81 192.18 24.81L196.77 5.52Z"/>
    <path fill="#188754" d="M18.37 99.91C9.98 85.37 -6.59 73.91 2.79 57.66C12.18 41.41 30.42 50.03 47.22 50.03C49.26 47.72 51.36 45.48 53.54 43.3C70.94 25.9 92.71 12.87 117.07 6L121.66 25.29C100.93 31.29 82.39 42.46 67.54 57.31C44.7 80.15 30.56 111.72 30.56 146.59C30.56 157 31.83 167.11 34.2 176.78L15.19 182.45C12.3 170.98 10.76 158.96 10.76 146.59C10.76 130.27 13.43 114.57 18.37 99.91Z"/>
    <path fill="#fff" fill-rule="evenodd" d="M227.24 75.88C245.22 93.85 256.33 118.68 256.33 146.11C256.33 160.68 253.19 174.53 247.55 186.99L288.45 210.61L278.62 227.71L237.67 204.06C234.53 208.43 231.04 212.54 227.24 216.34C209.26 234.31 184.43 245.43 157.02 245.43C129.59 245.43 104.76 234.31 86.78 216.34C82.99 212.54 79.5 208.43 76.36 204.06L35.41 227.71L25.58 210.61L66.48 186.99C60.84 174.53 57.69 160.68 57.69 146.11C57.69 118.68 68.81 93.85 86.78 75.88C102.57 60.1 123.64 49.6 147.11 47.28L147.11 0.04L166.92 0.04L166.92 47.28C190.39 49.6 211.46 60.1 227.24 75.88ZM213.23 89.89C198.85 75.5 178.97 66.6 157.02 66.6C135.06 66.6 115.18 75.5 100.79 89.89C86.4 104.27 77.5 124.15 77.5 146.11C77.5 168.06 86.4 187.94 100.79 202.33C115.18 216.72 135.06 225.61 157.02 225.61C178.97 225.61 198.85 216.72 213.23 202.33C227.63 187.95 236.53 168.06 236.53 146.11C236.53 124.15 227.63 104.27 213.23 89.89Z"/>
    <path fill="#fff" d="M146.04 141.81L132.31 194.95L181.72 194.95L167.99 141.81C175.51 137.86 180.64 129.97 180.64 120.89C180.64 107.85 170.06 97.27 157.02 97.27C143.97 97.27 133.39 107.85 133.39 120.89C133.39 129.97 138.52 137.86 146.04 141.81Z"/>
  </g>`;
}

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
  const style    = ROLE_STYLES[data.role] ?? ROLE_STYLES.attendee;
  const hasPhoto = Boolean(data.headshotDataUrl);
  const hasHero  = Boolean(data.heroImageDataUrl);

  const W = 1200;
  const H = 630;
  const STRIPE_H = 6;          // rainbow stripe height

  // ── Safe zone (10 % inset from all edges) ──────────────────────────────
  // Platforms crop differently:
  //   Facebook:  ~4 % all around
  //   Twitter/X: up to 15 % top+bottom on some views
  //   LinkedIn:  ~5 %
  //   WhatsApp:  ~5 %
  // We use 10 % as a good middle ground for critical content.
  const SAFE_L = 120;          // 10 % of 1200
  const SAFE_R = W - 120;
  const SAFE_T = 63;           // 10 % of 630
  const SAFE_B = H - 63;

  // ── Bottom branding bar (solid black like website footer) ──────────────
  const BRAND_H   = 56;
  const BRAND_TOP = H - STRIPE_H - BRAND_H;

  // ── Text column — leaves room for headshot when present ────────────────
  const TEXT_R = hasPhoto ? 720 : SAFE_R;

  // ── Prepare text ───────────────────────────────────────────────────────
  const fullName    = `${data.firstName} ${data.lastName}`.trim();
  const nameSize    = nameFontSize(fullName, TEXT_R);
  const dateStr     = formatDateRange(data.startsAt, data.endsAt);
  const eventName   = escapeXml(clampText(data.eventName, 50));
  const personName  = escapeXml(fullName);
  const actionStr   = escapeXml(style.action);
  const chipLabel   = escapeXml(style.chip);
  const locationStr = data.location ? escapeXml(data.location) : "";
  const dateEsc     = escapeXml(dateStr);
  const orgStr      = data.organization ? escapeXml(clampText(data.organization, 40)) : "";
  const titleStr    = data.jobTitle ? escapeXml(clampText(data.jobTitle, 40)) : "";

  // Build subtitle line: "Job Title · Organization" or just one
  const subtitleParts: string[] = [];
  if (titleStr) subtitleParts.push(titleStr);
  if (orgStr) subtitleParts.push(orgStr);
  const subtitle = subtitleParts.join(" · ");

  // ── Event info (top of safe zone) ──────────────────────────────────────
  const EVENT_SIZE = 26;
  const META_SIZE  = 15;

  // Event date + location line
  const metaParts: string[] = [];
  if (dateEsc) metaParts.push(dateEsc);
  if (locationStr) metaParts.push(locationStr);
  const metaLine = metaParts.join("  ·  ");

  // ── Role chip — upper-right in safe zone ───────────────────────────────
  const chipPadX  = 18;
  const chipCharW = 8;
  const chipW     = Math.round(chipLabel.length * chipCharW + chipPadX * 2);
  const chipX     = SAFE_R - chipW;
  const chipY     = SAFE_T;
  const chipH     = 28;

  // ── Person area — vertically centred between event info and brand bar ──
  const personAreaTop    = SAFE_T + EVENT_SIZE + 10 + META_SIZE + 40;
  const personAreaBottom = BRAND_TOP - 20;
  const personAreaMid    = Math.round((personAreaTop + personAreaBottom) / 2);

  // Stack: name + subtitle + action — centred vertically
  const GAP_SUB    = 8;
  const GAP_ACTION = 14;
  const SUB_SIZE   = 20;
  const ACTION_SIZE = 22;
  const totalStack = nameSize + (subtitle ? GAP_SUB + SUB_SIZE : 0) + GAP_ACTION + ACTION_SIZE;
  const stackTop   = personAreaMid - Math.round(totalStack / 2);

  const nameY    = stackTop + nameSize;
  const subY     = subtitle ? nameY + GAP_SUB + SUB_SIZE : nameY;
  const actionY  = subY + GAP_ACTION + ACTION_SIZE;

  // ── Headshot circle — centred in person area, right side ───────────────
  const HS_CX = 960;
  const HS_CY = personAreaMid;
  const HS_R  = Math.min(110, Math.round((personAreaBottom - personAreaTop) / 2 - 10));

  // ── Watermark — large PKI icon, faint colour ──────────────────────────
  const wmH = 380;
  const wmX = hasPhoto ? 680 : 780;
  const wmY = Math.round(personAreaMid - wmH / 2);

  // ── Bottom branding ────────────────────────────────────────────────────
  const LOGO_H = 34;
  const logoY  = BRAND_TOP + Math.round((BRAND_H - LOGO_H) / 2);

  // ── CTA pill (psychology: personal invitation + button affordance) ──────
  // "Join me, register now!" activates mimetic desire (the sharer is the
  // social proof) + present-bias urgency ("now"). Solid green = action colour.
  // The pill shape primes click behaviour in a static image (button affordance).
  // Arrow drawn as SVG path — Unicode arrows are not in Roboto so fall back to
  // a box glyph; a path always renders correctly.
  const PILL_H  = LOGO_H;                      // matches logo height (34)
  const PILL_W  = 248;
  const PILL_X  = SAFE_R - PILL_W;
  const PILL_Y  = logoY;
  const PILL_CY = PILL_Y + Math.round(PILL_H / 2);
  const PILL_TX = PILL_X + Math.round(PILL_W / 2) - 10; // slightly left of centre — room for arrow
  const PILL_TY = PILL_CY + 5; // baseline
  // Arrow drawn as SVG path — a proper right-pointing arrow (→) with line
  // and arrowhead, not a chevron. Centred vertically in the pill.
  const ARW_X   = PILL_X + PILL_W - 30;
  const ARW_CY  = PILL_CY;

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
  ${hasHero ? `<!-- Hero image covers full card -->
  <image href="${data.heroImageDataUrl}" x="0" y="0" width="${W}" height="${H}"
         preserveAspectRatio="xMidYMid slice"/>
  <!-- Dark overlay (matches website bg-dark bg-opacity-50) -->
  <rect width="${W}" height="${H}" fill="#000" opacity="0.20"/>
  <!-- Bottom fade to BG for readability -->
  <rect width="${W}" height="${H}" fill="url(#fadeDown)"/>` : `<!-- No hero — solid dark background (already set above) -->`}

  <!-- ═══ EVENT INFO (top of safe zone) ═══ -->

  <!-- Event name -->
  <text x="${SAFE_L}" y="${SAFE_T + EVENT_SIZE}"
        font-family="${FONT}" font-size="${EVENT_SIZE}" font-weight="700"
        fill="#ffffff">${eventName}</text>

  <!-- Event date + location -->
  ${metaLine ? `<text x="${SAFE_L}" y="${SAFE_T + EVENT_SIZE + 8 + META_SIZE}"
        font-family="${FONT}" font-size="${META_SIZE}" font-weight="400"
        fill="rgba(255,255,255,0.65)">${escapeXml(metaLine)}</text>` : ""}

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

  ${subtitle ? `<!-- Organization / Job title -->
  <text x="${SAFE_L}" y="${subY}"
        font-family="${FONT}" font-size="${SUB_SIZE}" font-weight="400"
        fill="rgba(255,255,255,0.55)">${escapeXml(subtitle)}</text>` : ""}

  <!-- Action phrase -->
  <text x="${SAFE_L}" y="${actionY}"
        font-family="${FONT}" font-size="${ACTION_SIZE}" font-weight="400"
        fill="${style.accent}">${actionStr}</text>

  ${hasPhoto ? `<!-- Headshot -->
  <circle cx="${HS_CX}" cy="${HS_CY}" r="${HS_R + 3}" fill="#ffffff" opacity="0.15"/>
  <image href="${data.headshotDataUrl}" x="${HS_CX - HS_R}" y="${HS_CY - HS_R}"
         width="${HS_R * 2}" height="${HS_R * 2}"
         clip-path="url(#hsClip)" preserveAspectRatio="xMidYMid slice"/>
  <circle cx="${HS_CX}" cy="${HS_CY}" r="${HS_R}"
          fill="none" stroke="#ffffff" stroke-width="2"/>` : ""}

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

  const BRAND_H   = 56;
  const BRAND_TOP = H - STRIPE_H - BRAND_H;

  // ── Text ──────────────────────────────────────────────────────────────────
  const fullName   = [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || "A supporter";
  const nameSize   = nameFontSize(fullName, SAFE_R);
  const nameEsc    = escapeXml(fullName);
  const amountEsc  = escapeXml(data.formattedAmount);

  // ── Chip ──────────────────────────────────────────────────────────────────
  const chipLabel = "Supporter";
  const chipPadX  = 18;
  const chipCharW = 8;
  const chipW     = Math.round(chipLabel.length * chipCharW + chipPadX * 2);
  const chipX     = SAFE_R - chipW;
  const chipH     = 28;

  // ── Content area — below chip row to above brand bar ─────────────────────
  const personAreaTop    = SAFE_T + chipH + 20;
  const personAreaBottom = BRAND_TOP - 20;
  const personAreaMid    = Math.round((personAreaTop + personAreaBottom) / 2);

  // ── Vertical stack ────────────────────────────────────────────────────────
  const GAP_S    = 8;
  const GAP_M    = 14;
  const ACT_SIZE = 22;    // "donated"
  const AMT_SIZE = 96;    // amount — hero number
  const CTX_SIZE = 26;    // "to the PKI Consortium"
  const SUB_SIZE = 18;    // caption

  const totalStack = nameSize + GAP_S + ACT_SIZE + GAP_M + AMT_SIZE + GAP_S + CTX_SIZE + GAP_S + SUB_SIZE;
  const stackTop   = personAreaMid - Math.round(totalStack / 2);

  const nameY    = stackTop + nameSize;
  const actY     = nameY  + GAP_S + ACT_SIZE;
  const amtY     = actY   + GAP_M + AMT_SIZE;
  const ctxY     = amtY   + GAP_S + CTX_SIZE;
  const subY     = ctxY   + GAP_S + SUB_SIZE;

  // ── Bottom bar ────────────────────────────────────────────────────────────
  const LOGO_H = 34;
  const logoY  = BRAND_TOP + Math.round((BRAND_H - LOGO_H) / 2);

  // ── CTA pill ──────────────────────────────────────────────────────────────
  const PILL_H  = LOGO_H;
  const PILL_W  = 260;
  const PILL_X  = SAFE_R - PILL_W;
  const PILL_Y  = logoY;
  const PILL_CY = PILL_Y + Math.round(PILL_H / 2);
  const PILL_TX = PILL_X + Math.round(PILL_W / 2) - 10;
  const PILL_TY = PILL_CY + 5;
  const ARW_X   = PILL_X + PILL_W - 30;
  const ARW_CY  = PILL_CY;

  // ── Watermark ─────────────────────────────────────────────────────────────
  const wmH = 380;
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
  <g opacity="0.04">${pkiIconColor(780, wmY, wmH)}</g>

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
