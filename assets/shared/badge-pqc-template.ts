import { z } from "zod";
import { constants } from "../design/tokens";
import { BADGE_GENERIC_FONT_CSS } from "./badge-generic-template-assets";
import { BADGE_PQC_ARTWORK_ASSETS } from "./badge-pqc-template-assets";
import { badgeTemplateText as text, badgeTemplateVectorAsset } from "./badge-template-policy";
import { formatDateRange } from "./format-date";
import { BADGE_TEXT_FIT_WRAPPING, badgeTextFitFontSize, type BadgeTextFitField } from "./badge-template-text-fit";
import {
  BADGE_TEMPLATE_SPONSOR_GROUPS_MAX_COUNT,
  badgeSponsorSourceSchema,
  type BadgeSponsorSource,
  badgeTemplateAssetSchema,
  badgeTemplateSponsorGroupSchema,
  eventBadgeTemplateSchema,
  type EventBadgeTemplate,
} from "./schemas/event-badge-template";

/** Short links printed on the PQC conference badge back; organizers may replace them per event. */
export const PQC_CONFERENCE_BADGE_LINKS = {
  agenda: "pkic.org/pqcc",
  questions: "pkic.org/ask",
  join: "pkic.org/join",
} as const;

/**
 * The site's own font files, which the badge embeds so it prints identically everywhere: Roboto for text, Roboto Mono
 * for labels and codes, and Barokah Signature (Alifinart Studio, https://www.behance.net/alifinart) for the city line.
 * Callers supply the bytes (the browser loads these URLs on demand) so the font payload never ships inside a script
 * bundle. Provenance and licenses are in static/fonts/BadgeDesign-PROVENANCE.md.
 */
export const PQC_CONFERENCE_BADGE_FONT_URLS = {
  roboto_latin: "/fonts/Roboto-latin.woff2",
  roboto_latin_ext: "/fonts/Roboto-latin-ext.woff2",
  roboto_mono_latin: "/fonts/RobotoMono-latin.woff2",
  roboto_mono_latin_ext: "/fonts/RobotoMono-latin-ext.woff2",
  barokah_signature: "/fonts/BarokahSignature.woff2",
} as const;
const fontAssetSchema = badgeTemplateAssetSchema.refine((asset) => asset.mime === "font/woff2", "Use WOFF2 fonts.");

/** As designed: the PKI Consortium's Diamond sponsors on both sides and its Titanium sponsors on the back. */
export const PQC_CONFERENCE_BADGE_SPONSOR_GROUPS = [
  { source: "consortium", tierName: "Diamond", label: "Diamond sponsor" },
  { source: "consortium", tierName: "Titanium", label: "Titanium sponsors" },
] as const satisfies readonly { source: BadgeSponsorSource; tierName: string; label: string }[];

const printedLine = (max: number) => z.string().trim().max(max);
export const pqcConferenceBadgeTemplateInputSchema = z
  .object({
    title: printedLine(160).min(1),
    dates: printedLine(80),
    city: printedLine(80),
    /** The lead tier prints on both sides; the second tier prints on the back, as designed. */
    /**
     * The first group prints on both sides (the design's lead tier); every later group prints on the back and
     * collapses when it has no sponsors. Each group names its source explicitly.
     */
    sponsorGroups: z
      .array(badgeTemplateSponsorGroupSchema.omit({ key: true }).extend({ source: badgeSponsorSourceSchema }))
      .max(BADGE_TEMPLATE_SPONSOR_GROUPS_MAX_COUNT)
      .default(() => PQC_CONFERENCE_BADGE_SPONSOR_GROUPS.map((group) => ({ ...group }))),
    fonts: z
      .object({
        roboto_latin: fontAssetSchema,
        roboto_latin_ext: fontAssetSchema,
        roboto_mono_latin: fontAssetSchema,
        roboto_mono_latin_ext: fontAssetSchema,
        barokah_signature: fontAssetSchema,
      })
      .strict(),
    links: z
      .object({ agenda: printedLine(60), questions: printedLine(60), join: printedLine(60) })
      .strict()
      .default(PQC_CONFERENCE_BADGE_LINKS),
  })
  .strict();
export type PqcConferenceBadgeTemplateInput = z.input<typeof pqcConferenceBadgeTemplateInputSchema>;

/** Roboto Mono's Google Fonts subsets use the same Unicode ranges as the Roboto subsets in the generic font CSS. */
const MONO_LATIN_EXT_RANGE =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
const MONO_LATIN_RANGE =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const monoFace = (asset: keyof typeof PQC_CONFERENCE_BADGE_FONT_URLS, range: string) =>
  `@font-face{font-family:"Roboto Mono";font-style:normal;font-weight:100 700;font-display:swap;src:url("asset:${asset}") format("woff2");unicode-range:${range}}`;
/** The label and code face, and the signature script of the city line; both embedded so they print as designed. */
const PQC_FONT_FACE_CSS = [
  monoFace("roboto_mono_latin_ext", MONO_LATIN_EXT_RANGE),
  monoFace("roboto_mono_latin", MONO_LATIN_RANGE),
  `@font-face{font-family:"Barokah Signature";font-style:normal;font-weight:400;font-display:block;src:url("asset:barokah_signature") format("woff2")}`,
].join("\n");

/** Design px (420 × 592 at A6) to millimeters. */
const mm = (px: number) => `${Math.round(px * 0.25 * 1000) / 1000}mm`;

function decodedArtwork(key: keyof typeof BADGE_PQC_ARTWORK_ASSETS): string {
  return atob(BADGE_PQC_ARTWORK_ASSETS[key].base64);
}

/** The back's ink skyline is the same drawing, cropped to four houses and drawn heavier. */
function inkCanalHouses(): string {
  const source = decodedArtwork("canal_houses");
  const root = 'viewBox="-4 -26 1113 376" fill="none" stroke="#fff" stroke-width="2"';
  const windows = '<g stroke-width="1.4">';
  if (!source.includes(root) || !source.includes(windows))
    throw new Error("The canonical canal houses artwork changed; review the PQC badge preset.");
  return source
    .replace(root, `viewBox="-6 -20 457 326" fill="none" stroke="${constants["pqc-ink"]}" stroke-width="9"`)
    .replace(windows, '<g stroke-width="7">');
}

/** The key visual's fine dot grid, fading in toward the right edge of the header field. */
function dotGrid(): string {
  const token = constants["pqc-dots-fine"];
  const read = (name: string) => new RegExp(`${name}='([^']+)'`).exec(token)?.[1];
  const [size, cx, radius, fill] = [read("width"), read("cx"), read("r"), read("fill")];
  if (!size || !cx || !radius || !fill) throw new Error("The PQC dot grid token changed; review the badge preset.");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 232"><defs><pattern id="dots" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><circle cx="${cx}" cy="${cx}" r="${radius}" fill="${fill}"/></pattern><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0.4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient><mask id="reveal"><rect width="420" height="232" fill="url(#fade)"/></mask></defs><rect width="420" height="232" fill="url(#dots)" mask="url(#reveal)"/></svg>`;
}

function tiles(asset: string, count: number, className: string): string {
  return `<div class="${className}" aria-hidden="true">${`<img src="asset:${asset}" alt="" class="${className}-tile"/>`.repeat(count)}</div>`;
}

/**
 * The design's optical balance: every logo in a tier covers the same area (design px²) within its height and
 * width caps, so wide wordmarks and square marks carry equal visual weight. The renderer supplies each logo's
 * aspect ratio; without it a typical wordmark ratio applies.
 */
function opticalLogo(areaPx: number, maxHeightPx: number, maxWidthPx: number): string {
  const aspect = "var(--badge-logo-aspect,2.8)";
  const height = `min(${mm(maxHeightPx)},calc(sqrt(${areaPx * 0.0625} / ${aspect}) * 1mm),calc(${mm(maxWidthPx)} / ${aspect}))`;
  return `flex:0 0 auto;height:${height};width:calc(${height} * ${aspect})`;
}

/** The front role band and the back footer share one height, so their top edges line up across both sides. */
const BAR_MM = 15;
/**
 * The ink skyline stands on the footer: its viewBox (-20 to 306) ends 1.5 units below the stroke's lowest edge
 * (ground at 300 with a 9-unit stroke), so the tile drops by exactly that much onto the bar's top edge.
 */
const CANAL_MM = 7;
const CANAL_FOOT_MM = Math.round(((306 - (300 + 9 / 2)) / 326) * CANAL_MM * 1000) / 1000;

/** The front name column: the badge's inner width less the QR, its side code and the gap. */
const NAME_COLUMN_MM = 53;
const fit = (
  field: BadgeTextFitField,
  widthMm: number,
  maxMm: number,
  minMm: number,
  weight: "bold" | "regular",
  oneLineFloor?: number,
  lines?: number,
) => badgeTextFitFontSize({ field, widthMm, maxMm, minMm, weight, oneLineFloor, lines });

/**
 * The back keeps its top 12 mm clear for the lanyard hole. When a long name or organization needs more room, the
 * back QR yields (from 34 mm down to 26 mm) instead of the text or the sponsors overflowing.
 */
function css(): string {
  const c = constants;
  const mono = `font-family:${c["font-mono"]}`;
  const script = `font-family:"Barokah Signature","Mrs Saint Delafield","Snell Roundhand","Segoe Script",cursive`;
  return `${BADGE_GENERIC_FONT_CSS}
${PQC_FONT_FACE_CSS}
.pqc-badge{position:relative;width:105mm;height:148mm;overflow:hidden;display:flex;flex-direction:column;background:${c["pqc-paper"]};color:${c["pqc-ink"]};font-family:${c.font}}
.pqc-badge,.pqc-badge *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}.pqc-badge p{margin:0}
.pqc-field{position:relative;flex:0 0 ${mm(232)};overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:${mm(30)} ${mm(32)} ${mm(22)};background:${c["pqc-field"]};color:${c["pqc-on-field"]}}
.pqc-dots{position:absolute;left:0;top:0;width:105mm;height:${mm(232)}}
.pqc-mark{position:absolute;right:${mm(-70)};top:${mm(-40)};width:${mm(210)};height:${mm((210 * 324) / 314)};opacity:0.18}
.pqc-canal{position:absolute;left:0;right:0;bottom:0;height:${mm(38)};display:flex;overflow:hidden;opacity:0.34}.pqc-canal-tile{flex:0 0 auto;width:${mm((38 * 1113) / 376)};height:${mm(38)}}
.pqc-logo{position:relative;display:block;height:${mm(34)};width:${mm((34 * 1256) / 324)}}
.pqc-event{position:relative;display:flex;flex-direction:column;gap:${mm(8)}}
.pqc-title{font-size:${mm(25)};line-height:1.05;font-weight:700;letter-spacing:-0.02em}
.pqc-dates{${mono};font-size:${mm(12)};font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:${c["pqc-on-field-muted"]}}
.pqc-city{margin-top:${mm(2)};${script};font-size:${mm(9.84)};font-size-adjust:cap-height 2;line-height:${mm(30)}}
.pqc-stripe{flex:0 0 ${mm(6)};height:${mm(6)};background:${c["pqc-stripe"]}}
.pqc-person{flex:1;min-height:0;display:flex;gap:${mm(18)};align-items:flex-start;padding:${mm(22)} ${mm(32)} 0}
.pqc-names{flex:1;min-width:0;display:flex;flex-direction:column;gap:${mm(4)}}
.pqc-names p{${BADGE_TEXT_FIT_WRAPPING}}
.pqc-first,.pqc-display{line-height:1;font-weight:700;letter-spacing:-0.03em}
.pqc-first{font-size:${fit("firstName", NAME_COLUMN_MM, 11.5, 5, "bold")}}.pqc-display{font-size:${fit("displayName", NAME_COLUMN_MM, 11.5, 4, "bold")}}
.pqc-last{font-size:${fit("lastName", NAME_COLUMN_MM, 7.5, 3.5, "regular")};line-height:1.1;letter-spacing:-0.01em}
.pqc-display,.pqc-first:empty,.pqc-first:empty+.pqc-last{display:none}.pqc-first:empty~.pqc-display{display:block}
.pqc-job{font-size:${fit("jobTitle", NAME_COLUMN_MM, 4, 2.8, "bold", 0.75, 2)};line-height:1.3;font-weight:700}.pqc-job:empty{display:none}
.pqc-org{font-size:${fit("organization", NAME_COLUMN_MM, 4, 2.8, "regular", 1)};line-height:1.3;color:${c["pqc-ink-muted"]}}.pqc-org:empty{display:none}
.pqc-badge .pqc-job,.pqc-badge .pqc-job:empty+.pqc-org{margin-top:4.5mm}.pqc-badge .pqc-org{margin-top:0.5mm}
.pqc-qr-column{flex:0 0 30mm;width:30mm;display:flex;flex-direction:column;align-items:center;gap:1.5mm}.pqc-qr{width:30mm;height:30mm}
.pqc-code{white-space:nowrap;${mono};font-size:2.4mm;font-weight:500;line-height:1;letter-spacing:0.02em;color:${c["pqc-ink-muted"]}}
.pqc-badge .badge-template-sponsor-tier{${mono};font-weight:400;line-height:1;letter-spacing:0.2em;text-transform:uppercase;color:${c["pqc-ink-muted"]}}
.pqc-badge .badge-template-sponsor-logo{max-width:none;max-height:none;min-width:0}
.pqc-front-sponsors{padding:0 ${mm(32)} ${mm(20)}}.pqc-front-sponsors:empty,.pqc-back-lead:empty,.pqc-back-tier:empty{display:none}
.pqc-front-sponsors .badge-template-sponsors{align-items:flex-start;gap:4mm}.pqc-front-sponsors .badge-template-sponsor-tier{font-size:2.1mm}
.pqc-front-sponsors .badge-template-sponsor-logos{flex-wrap:nowrap;justify-content:flex-start;gap:${mm(24)};width:100%}
.pqc-front-sponsors .badge-template-sponsor-logo{${opticalLogo(5200, 40, 150)}}
.pqc-role{flex:0 0 ${BAR_MM}mm;height:${BAR_MM}mm;display:flex;align-items:center;padding:0 ${mm(32)};background:var(--badge-role-color);color:var(--badge-role-text);${mono};font-size:${mm(20)};font-weight:600;letter-spacing:0.18em;text-transform:uppercase}
.pqc-back-body{flex:1;min-height:0;display:flex;flex-direction:column;padding:12.5mm ${mm(32)} 9.5mm}
.pqc-back-person{flex-shrink:0;display:flex;flex-direction:column;gap:${mm(6)};padding-bottom:3mm}
.pqc-back-person p{${BADGE_TEXT_FIT_WRAPPING}}
.pqc-back-name{font-size:${fit("displayName", 89, 8, 4, "bold")};line-height:1.05;font-weight:700;letter-spacing:-0.03em}
.pqc-badge .pqc-back-meta{margin-top:2mm}.pqc-back-meta{font-size:min(${fit("jobTitle", 89, 3.75, 2.5, "bold", 1)},${fit("organization", 89, 3.75, 2.5, "regular", 1)});line-height:1.3}
.pqc-back-job{font-weight:700}.pqc-back-org{color:${c["pqc-ink-muted"]}}.pqc-back-org::before{content:" · "}
.pqc-back-job:empty,.pqc-back-org:empty,.pqc-back-meta:empty{display:none}.pqc-back-job:empty+.pqc-back-org::before{content:none}
.pqc-back-details{flex:0 1 auto;height:38mm;min-height:30mm;margin-top:auto;padding-top:4mm;border-top:0.25mm solid ${c["pqc-rule"]};display:flex;gap:${mm(24)};align-items:center}
.pqc-back-qr{flex:0 0 auto;height:100%;width:auto;aspect-ratio:1}
.pqc-back-links{display:grid;grid-template-columns:auto 1fr;gap:${mm(10)} ${mm(14)};align-items:baseline;min-width:0;${mono}}
.pqc-key{font-size:${mm(10)};letter-spacing:0.14em;text-transform:uppercase;color:${c["pqc-ink-muted"]}}.pqc-value{font-size:${mm(14)};font-weight:500;overflow-wrap:anywhere}.pqc-id{font-size:${mm(11)};white-space:nowrap}
.pqc-back-sponsors{flex-shrink:0;margin-top:auto;padding-top:3mm;display:flex;flex-direction:column;gap:5mm}
.pqc-back-sponsors .badge-template-sponsors{align-items:stretch;gap:4.5mm}
.pqc-back-sponsors .badge-template-sponsor-tier{display:flex;align-items:center;gap:${mm(10)};font-size:2mm}
.pqc-back-sponsors .badge-template-sponsor-tier::before,.pqc-back-sponsors .badge-template-sponsor-tier::after{content:"";flex:1;height:0.25mm;background:${c["pqc-rule"]}}
.pqc-back-lead .badge-template-sponsor-logos{flex-wrap:nowrap;gap:${mm(28)}}.pqc-back-lead .badge-template-sponsor-logo{${opticalLogo(5200, 44, 160)}}
.pqc-back-tier .badge-template-sponsor-logos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${mm(14)} ${mm(24)}}.pqc-back-tier .badge-template-sponsor-logo{justify-self:center;${opticalLogo(1500, 26, 120)}}
.pqc-back-canal{position:relative;flex:0 0 ${CANAL_MM}mm;margin:-${CANAL_MM}mm 0 -${CANAL_FOOT_MM}mm;display:flex;overflow:hidden;opacity:0.16}.pqc-back-canal-tile{flex:0 0 auto;width:${mm((28 * 457) / 326)};height:${CANAL_MM}mm}
.pqc-back-footer{flex:0 0 ${BAR_MM}mm;height:${BAR_MM}mm;display:flex;align-items:center;justify-content:space-between;padding:0 ${mm(32)};background:${c["pqc-ink"]}}
.pqc-footer-logo{display:block;height:${mm(26)};width:${mm((26 * 1256) / 324)}}
.pqc-join{${mono};font-size:${mm(12)};letter-spacing:0.12em;color:${c["pqc-on-field-muted"]}}`;
}

/**
 * The PQC Conference badge from the conference design kit, as a reusable organizer template: the field header
 * with dot grid, cropped mark and canal houses; attendee name, organization and QR; the lead sponsor tier; and the
 * role band. Every graphic is vector artwork; organizers can still edit the result like any other template.
 */
export function createPqcConferenceBadgeTemplate(input: PqcConferenceBadgeTemplateInput): EventBadgeTemplate {
  const parsed = pqcConferenceBadgeTemplateInputSchema.parse(input);
  const { title, dates, city, fonts, links } = parsed;
  const sponsorGroups = parsed.sponsorGroups.map((group, index) => ({
    key: `${group.source}-${index + 1}`,
    source: group.source,
    tierName: group.tierName,
    label: group.label ?? `${group.tierName} sponsors`,
  }));
  const slot = (index: number) => (sponsorGroups[index] ? `{{sponsors:${sponsorGroups[index].key}}}` : "");
  const line = (value: string, className: string) => (value ? `<p class="${className}">${text(value)}</p>` : "");
  const field = `<div class="pqc-field"><img src="asset:dot_grid" alt="" class="pqc-dots"/><img src="asset:mark" alt="" class="pqc-mark"/>${tiles("canal_houses", 4, "pqc-canal")}<img src="asset:logo_white" alt="PKI Consortium" class="pqc-logo"/><div class="pqc-event">${line(title, "pqc-title")}${line(dates, "pqc-dates")}${line(city, "pqc-city")}</div></div>`;
  const person =
    '<div class="pqc-person"><div class="pqc-names"><p class="pqc-first">{{firstName}}</p><p class="pqc-last">{{lastName}}</p><p class="pqc-display">{{displayName}}</p><p class="pqc-job">{{jobTitle}}</p><p class="pqc-org">{{organization}}</p></div><div class="pqc-qr-column"><div class="pqc-qr">{{qrImage}}</div><span class="pqc-code">{{badgeCode}}</span></div></div>';
  const backLinks = `<span class="pqc-key">ID</span><span class="pqc-value pqc-id">{{badgeCode}}</span>${[
    ["Agenda", links.agenda],
    ["Q&A", links.questions],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `<span class="pqc-key">${text(key)}</span><span class="pqc-value">${text(value)}</span>`)
    .join("")}`;
  const backDetails = `<div class="pqc-back-details"><div class="pqc-back-qr">{{qrImage}}</div><div class="pqc-back-links">${backLinks}</div></div>`;
  const backSponsors = `<div class="pqc-back-sponsors"><div class="pqc-back-lead">${slot(0)}</div>${sponsorGroups
    .slice(1)
    .map((_, index) => `<div class="pqc-back-tier">${slot(index + 1)}</div>`)
    .join("")}</div>`;
  const footer = `<div class="pqc-back-footer"><img src="asset:logo_white" alt="PKI Consortium" class="pqc-footer-logo"/>${links.join ? `<span class="pqc-join">${text(links.join)}</span>` : ""}</div>`;
  return eventBadgeTemplateSchema.parse({
    version: 1,
    name: "PQC conference badge",
    widthMm: 105,
    heightMm: 148,
    frontHtml: `<div class="pqc-badge pqc-front">${field}<div class="pqc-stripe"></div>${person}<div class="pqc-front-sponsors">${slot(0)}</div><div class="pqc-role">{{badgeRole}}</div></div>`,
    backHtml: `<div class="pqc-badge pqc-back"><div class="pqc-stripe"></div><div class="pqc-back-body"><div class="pqc-back-person"><p class="pqc-back-name">{{displayName}}</p><p class="pqc-back-meta"><strong class="pqc-back-job">{{jobTitle}}</strong><span class="pqc-back-org">{{organization}}</span></p></div>${backDetails}${backSponsors}</div>${tiles("canal_houses_ink", 11, "pqc-back-canal")}${footer}</div>`,
    css: css(),
    assets: {
      ...fonts,
      logo_white: BADGE_PQC_ARTWORK_ASSETS.logo_white,
      mark: BADGE_PQC_ARTWORK_ASSETS.mark,
      canal_houses: BADGE_PQC_ARTWORK_ASSETS.canal_houses,
      canal_houses_ink: badgeTemplateVectorAsset(inkCanalHouses()),
      dot_grid: badgeTemplateVectorAsset(dotGrid()),
    },
    sponsorGroups,
  });
}

/**
 * Organizer starting point: the event's own name, dates in its zone and city; the designed consortium sponsor
 * groups; then up to two of the current design's event-tier groups, which print only when they have sponsors.
 */
export function pqcConferenceBadgeTemplateForEvent(
  event: {
    name: string;
    startsAt: string | null;
    endsAt: string | null;
    timezone: string;
    location: string | null;
  },
  currentGroups: readonly { source?: BadgeSponsorSource; tierName: string; label?: string }[],
  fonts: PqcConferenceBadgeTemplateInput["fonts"],
): EventBadgeTemplate {
  return createPqcConferenceBadgeTemplate({
    title: event.name.trim().slice(0, 160),
    dates: event.startsAt ? formatDateRange(event.startsAt, event.endsAt, event.timezone) : "",
    city: (event.location?.split(",")[0] ?? "").trim().slice(0, 80),
    sponsorGroups: [
      ...PQC_CONFERENCE_BADGE_SPONSOR_GROUPS,
      ...currentGroups
        .filter((group) => (group.source ?? "event") === "event")
        .slice(0, 2)
        .map(({ tierName, label }) => ({ source: "event" as const, tierName, ...(label ? { label } : {}) })),
    ],
    fonts,
  });
}
