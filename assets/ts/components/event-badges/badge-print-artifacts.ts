import { BADGE_GENERIC_FONT_LICENSE } from "../../../shared/badge-generic-template-assets";
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
  for (const page of badgePrintPages(badges.length, layout)) {
    pages.push(
      `<section class="badge-print-sheet" aria-label="Badge sheet">${page.slots
        .map((slot) => {
          const badge = badges[slot.itemIndex];
          const body = compiled
            ? `<div class="badge-template-surface">${compiled.renderSide(slot.side, badge)}</div>`
            : `<div class="name">${escapeHtml(badge.displayName)}</div><img alt="Attendee badge QR code" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(badge.svg)}">`;
          return `<article class="badge-print-slot${compiled ? " badge--template" : ""}" style="left:${slot.xMm}mm;top:${slot.yMm}mm;width:${slot.widthMm}mm;height:${slot.heightMm}mm" aria-label="Badge ${slot.side}">${body}</article>`;
        })
        .join("")}</section>`,
    );
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BADGE_PRINT_CONTENT_SECURITY_POLICY}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title>Attendee badges</title><style>
@page{size:${dimensions.widthMm}mm ${dimensions.heightMm}mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#111;background:white}.badge-print-sheet{width:${dimensions.widthMm}mm;height:${dimensions.heightMm}mm;position:relative;break-after:page;break-inside:avoid}.badge-print-sheet:last-child{break-after:auto}.badge-print-slot{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2mm;padding:3mm;overflow:hidden}.badge-print-slot:not(.badge--template) img{width:75%;max-height:70%;object-fit:contain;min-height:0}.name{font-size:14pt;font-weight:bold;overflow-wrap:anywhere;text-align:center}.badge-side{font-size:8pt}@media screen{body{background:#eee}.badge-print-sheet{background:white;margin:10px auto;box-shadow:0 1px 5px #aaa}}
${compiled?.css ?? ""}
.badge--template{display:block;padding:0}.badge-template-surface{width:${template?.widthMm ?? layout.label.widthMm}mm;height:${template?.heightMm ?? layout.label.heightMm}mm}
</style></head><body>${compiled?.resourcesHtml ?? ""}<div hidden aria-hidden="true"><pre>${escapeHtml(BADGE_GENERIC_FONT_LICENSE)}</pre></div>${pages.join("")}</body></html>`;
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

export function badgePrintCsv(badges: readonly FreshBadgePrint[]): string {
  const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return [
    "Name,Credential,Reference",
    ...badges.map((badge) => [badge.displayName, badge.credential, badge.id].map(cell).join(",")),
  ].join("\r\n");
}

export function downloadBadgeArtifact(content: string | Blob, type: string, filename: string): void {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Let the browser consume the download before releasing the transient URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
