import { z } from "zod";
import { constants, themes } from "../design/tokens";
import { BADGE_GENERIC_BRAND_ASSETS, BADGE_GENERIC_FONT_CSS } from "./badge-generic-template-assets";
import { eventBadgeTemplateSchema, type EventBadgeTemplate } from "./schemas/event-badge-template";
import { eventResourceCoreSchema } from "./schemas/event-management";

export const genericBadgeTemplateInputSchema = z
  .object({
    eventName: eventResourceCoreSchema.shape.name,
    customTextOverlay: z.string().max(500).optional(),
    sponsorGroups: eventBadgeTemplateSchema.shape.sponsorGroups,
  })
  .strict();
export type GenericBadgeTemplateInput = z.infer<typeof genericBadgeTemplateInputSchema>;

function escape(value: string): string {
  return value
    .replace(
      /[&<>"']/g,
      (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!,
    )
    .replace(/[{}]/g, (character) => `<span>${character}</span>`);
}
function vectorAsset(svg: string): EventBadgeTemplate["assets"][string] {
  return { mime: "image/svg+xml", base64: btoa(svg) };
}

/** Generic owned-event default. Uploaded event artwork remains a separate explicit template override. */
export function createGenericBadgeTemplate(input: GenericBadgeTemplateInput): EventBadgeTemplate {
  const { eventName, customTextOverlay, sponsorGroups } = genericBadgeTemplateInputSchema.parse(input);
  const brandStops = [...constants["grad-brand"].matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0]);
  if (brandStops.length !== 3) throw new Error("The canonical PKIC brand gradient needs three color stops.");
  const brandStripe = vectorAsset(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 105 3"><defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">${brandStops.map((color, index) => `<stop offset="${index / 2}" stop-color="${color}"/>`).join("")}</linearGradient></defs><rect width="105" height="3" fill="url(#brand)"/></svg>`,
  );
  const roleBand = vectorAsset(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 105 12"><rect width="105" height="12" fill="var(--badge-role-color)"/></svg>',
  );
  const heading = `<div class="badge-generic-heading"><img src="asset:mark" alt="PKI Consortium" class="badge-generic-mark"/><div><p class="badge-generic-brand">PKI Consortium</p><p class="badge-generic-event">${escape(eventName)}</p></div></div><img src="asset:brand_stripe" alt="" class="badge-generic-stripe"/>`;
  const name =
    '<div class="badge-generic-name">{{displayName}}</div><div class="badge-generic-organization">{{organization}}</div>';
  const overlay = customTextOverlay?.trim() ? `<p class="badge-generic-overlay">${escape(customTextOverlay)}</p>` : "";
  const role =
    '<div class="badge-generic-band"><img src="asset:role_band" alt="" class="badge-generic-band-vector"/><span class="badge-generic-role">{{badgeRole}}</span></div>';
  const frontSponsors = sponsorGroups[0]
    ? `<div class="badge-generic-front-sponsors">{{sponsors:${sponsorGroups[0].key}}}</div>`
    : "";
  const backSponsors = sponsorGroups
    .map((group) => `<div class="badge-generic-tier">{{sponsors:${group.key}}}</div>`)
    .join("");
  return eventBadgeTemplateSchema.parse({
    version: 1,
    name: "PKI Consortium event badge",
    widthMm: 105,
    heightMm: 148,
    frontHtml: `<div class="badge-generic-front">${heading}<div class="badge-generic-person">${name}${overlay}</div><div class="badge-generic-qr">{{qr}}</div>${frontSponsors}${role}</div>`,
    backHtml: `<div class="badge-generic-back">${heading}<div class="badge-generic-back-person">${name}</div><div class="badge-generic-back-qr">{{qr}}</div>${overlay}<div class="badge-generic-all-sponsors">${backSponsors}</div>${role}</div>`,
    assets: { ...BADGE_GENERIC_BRAND_ASSETS, brand_stripe: brandStripe, role_band: roleBand },
    sponsorGroups,
    css: `${BADGE_GENERIC_FONT_CSS}
.badge-generic-front,.badge-generic-back{width:105mm;height:148mm;box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;background:${themes.light.surface};color:${themes.light.ink};font-family:${constants.font};padding:6mm 6mm 16mm;gap:2mm}
.badge-generic-heading{width:100%;display:flex;align-items:center;gap:4mm;min-height:15mm}.badge-generic-mark{width:13mm;height:14mm;flex-shrink:0}.badge-generic-brand{font-size:12pt;font-weight:700;margin:0}.badge-generic-event{font-size:10pt;margin:1mm 0 0;overflow-wrap:anywhere}.badge-generic-stripe{width:93mm;height:2.7mm;flex-shrink:0}
.badge-generic-person{width:100%;text-align:center;margin-top:2mm}.badge-generic-name{font-size:24pt;font-weight:750;line-height:1.12;overflow-wrap:anywhere}.badge-generic-organization{font-size:11pt;margin-top:1mm;overflow-wrap:anywhere}.badge-generic-overlay{font-size:9pt;white-space:pre-wrap;overflow-wrap:anywhere;text-align:center;margin:1mm 0}
.badge-generic-qr{width:48mm;height:57mm;flex-shrink:0}.badge-generic-front-sponsors{margin-top:auto;width:100%}.badge-generic-front-sponsors .badge-template-sponsor-logo{width:34mm;height:10mm}.badge-generic-front-sponsors .badge-template-sponsors{gap:1mm;font-size:8pt}
.badge-generic-band{position:absolute;left:0;bottom:0;width:105mm;height:12mm;display:flex;align-items:center;justify-content:center}.badge-generic-band-vector{position:absolute;inset:0;width:105mm;height:12mm}.badge-generic-role{position:relative;color:var(--badge-role-text);font-size:17pt;font-weight:750;letter-spacing:0.15em}
.badge-generic-back-person{width:100%;text-align:center}.badge-generic-back-person .badge-generic-name{font-size:16pt}.badge-generic-back-person .badge-generic-organization{font-size:9pt}.badge-generic-back-qr{width:32mm;height:39mm;flex-shrink:0}.badge-generic-all-sponsors{margin-top:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2mm;width:100%}.badge-generic-tier .badge-template-sponsors{font-size:8pt;gap:1mm}.badge-generic-tier .badge-template-sponsor-logos{gap:1mm}.badge-generic-tier .badge-template-sponsor-logo{width:18mm;height:7mm}`,
  });
}
