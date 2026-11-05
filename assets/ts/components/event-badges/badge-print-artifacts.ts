import printerTemplate from "../../../../data/badge-personalization.json";
import { escapeCsvField } from "../../../shared/csv";
import { splitBadgePrintSvg } from "../../../shared/badge-print-svg";
import { badgeCredentialSchema, formatBadgeCredential } from "../../../shared/schemas/badge-credential";
import { BADGE_DISPLAY_ROLE_LABELS } from "../../../shared/schemas/participant-roles";
import { badgeLabelSvg } from "../../../shared/badge-label-svg";
import { BADGE_GENERIC_FONT_LICENSE } from "../../../shared/badge-generic-font-license";
import { compileBadgeTemplate, BADGE_PRINT_CONTENT_SECURITY_POLICY } from "../../../shared/badge-template-render";
import type { BadgePrintingContext } from "../../../shared/schemas/route-contracts-event-badges";
import type { BadgePrintDesign } from "../../../shared/schemas/event-badge-template";
import type { BadgeDisplayRole } from "../../../shared/schemas/participant-roles";
import { badgeFaceLayout, badgePrintPages, badgePrintPreset } from "../../../shared/badge-print-layout";
import {
  badgePrintLayoutSchema,
  badgePrintSettingsForTemplate,
  badgePrintPageDimensions,
  type BadgePrintLayout,
} from "../../../shared/schemas/badge-print-layout";
/** Printable bearers remain transient; only an explicit download saves them. */
export interface PrintableBadgePrint {
  id: string;
  credential?: string;
  displayName: string;
  svg: string;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  jobTitle?: string | null;
  badgeRole: BadgeDisplayRole;
}
export interface FreshBadgePrint extends PrintableBadgePrint {
  credential: string;
}
export type { BadgePrintLayout } from "../../../shared/schemas/badge-print-layout";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function badgePrintHtml(
  badges: readonly PrintableBadgePrint[],
  input: BadgePrintLayout,
  printing: BadgePrintingContext,
  design: BadgePrintDesign,
): string {
  const layout = badgePrintLayoutSchema.parse(input);
  const template = printing.template;
  badgePrintSettingsForTemplate(template).parse({ ...layout, design });
  const compiled = design === "event_badge" && template ? compileBadgeTemplate(template, printing.branding) : null;
  const dimensions = badgePrintPageDimensions(layout.page);
  const pages: string[] = [];
  const slotStyles: string[] = [];
  const labels = new Map<number, string>();
  for (const page of badgePrintPages(badges.length, layout)) {
    pages.push(
      `<section class="badge-print-sheet" data-print-key="${page.slots.map((slot) => `${slot.itemIndex}:${compiled ? slot.side : "label"}:${slot.xMm}:${slot.yMm}:${slot.widthMm}:${slot.heightMm}`).join("|")}" aria-label="Badge sheet">${page.slots
        .map((slot) => {
          const badge = badges[slot.itemIndex];
          if (!compiled && !labels.has(slot.itemIndex)) {
            const svg = badgeLabelSvg({ ...badge, jobTitle: badge.jobTitle ?? null }, slot.widthMm, slot.heightMm);
            labels.set(
              slot.itemIndex,
              `<symbol id="badge-label-${slot.itemIndex}" viewBox="0 0 ${slot.widthMm} ${slot.heightMm}">${svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"))}</symbol>`,
            );
          }
          const body = compiled
            ? `<div class="badge-template-surface">${compiled.renderSide(slot.side, badge)}</div>`
            : `<svg xmlns="http://www.w3.org/2000/svg" class="badge-label" viewBox="0 0 ${slot.widthMm} ${slot.heightMm}" role="img" aria-label="${escapeHtml(badge.displayName)}"><use href="#badge-label-${slot.itemIndex}"/></svg>`;
          const slotClass = `badge-print-slot-${slotStyles.length}`;
          slotStyles.push(
            `.${slotClass}{left:${slot.xMm}mm;top:${slot.yMm}mm;width:${slot.widthMm}mm;height:${slot.heightMm}mm}`,
          );
          return `<article class="badge-print-slot ${slotClass}${compiled ? " badge--template" : ""}" aria-label="Badge ${slot.side}">${body}</article>`;
        })
        .join("")}</section>`,
    );
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BADGE_PRINT_CONTENT_SECURITY_POLICY}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title>Attendee ${design === "name_qr" ? "labels" : "badges"}</title><style>
@page{size:${dimensions.widthMm}mm ${dimensions.heightMm}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:${dimensions.widthMm}mm}body{font-family:Arial,sans-serif;color:#111;background:white}.badge-print-sheet{width:${dimensions.widthMm}mm;height:${dimensions.heightMm}mm;position:relative;break-after:page;break-inside:avoid;overflow:hidden}.badge-print-sheet:last-child{break-after:auto}.badge-print-slot{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2mm;padding:3mm;overflow:hidden}.badge-print-slot:has(.badge-label){padding:0}.badge-print-slot .badge-label{width:100%;height:100%;object-fit:contain;min-height:0}@media screen{body{background:#eee}.badge-print-sheet{background:white;margin:10px auto;box-shadow:0 1px 5px #aaa}}
.badge-print-label-resources{position:absolute;width:0;height:0;overflow:hidden}
${compiled?.css ?? ""}
${slotStyles.join("\n")}
.badge--template{display:block;padding:0}.badge-template-surface{width:${template?.widthMm ?? layout.label.widthMm}mm;height:${template?.heightMm ?? layout.label.heightMm}mm}
</style></head><body>${compiled?.resourcesHtml ?? ""}${labels.size ? `<svg xmlns="http://www.w3.org/2000/svg" class="badge-print-label-resources" aria-hidden="true"><defs>${[...labels.values()].join("")}</defs></svg>` : ""}<div hidden aria-hidden="true"><pre>${escapeHtml(BADGE_GENERIC_FONT_LICENSE)}</pre></div>${pages.join("")}</body></html>`;
}

/** One face of one badge through the print renderer, on a page of exactly the badge's printed size. */
export function badgeFaceHtml(
  badge: PrintableBadgePrint,
  printing: BadgePrintingContext,
  side: "front" | "back" = "front",
): { html: string; widthMm: number; heightMm: number } {
  const template = printing.template;
  const layout = template
    ? badgeFaceLayout(template.widthMm, template.heightMm, side)
    : { ...badgePrintPreset("label_100_50"), sides: side };
  return {
    html: badgePrintHtml([badge], layout, printing, template ? "event_badge" : "name_qr"),
    widthMm: layout.label.widthMm,
    heightMm: layout.label.heightMm,
  };
}

/** Recovered print documents contain the same code as newly issued badges. */
export function badgePrintCredential(badge: PrintableBadgePrint): string | null {
  const encoded = splitBadgePrintSvg(badge.svg)?.code;
  const supplied = badge.credential;
  const parsed = badgeCredentialSchema.safeParse(encoded ?? supplied);
  if (!parsed.success) return null;
  if (supplied && badgeCredentialSchema.safeParse(supplied).data !== parsed.data) return null;
  return parsed.data;
}

export function badgePrintCsv(badges: readonly PrintableBadgePrint[]): string {
  // Column names follow the printer personalization template.
  const header = printerTemplate.columns;
  const rows = badges.map((badge) => {
    const credential = badgePrintCredential(badge);
    if (!credential) throw new Error("This badge has no printable QR code. Reload its print document.");
    return [
      BADGE_DISPLAY_ROLE_LABELS[badge.badgeRole],
      badge.firstName,
      badge.lastName,
      badge.jobTitle,
      badge.organization,
      formatBadgeCredential(credential),
      credential,
    ];
  });
  return "\uFEFF" + [header, ...rows].map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}

export { downloadFile as downloadBadgeArtifact } from "../../shared/download-file";
