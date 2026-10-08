/** Printable bearers remain transient; only an explicit download saves them. */
export interface PrintableBadgePrint {
  id: string;
  displayName: string;
  svg: string;
}
export interface FreshBadgePrint extends PrintableBadgePrint {
  credential: string;
}
export type BadgePrintLayout = "a6" | "label";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function badgePrintHtml(badges: readonly PrintableBadgePrint[], layout: BadgePrintLayout): string {
  const width = layout === "a6" ? 105 : 100;
  const height = layout === "a6" ? 148 : 50;
  const qr = layout === "a6" ? 72 : 36;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><title>Attendee badges</title><style>
@page{size:${width}mm ${height}mm;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#111;background:white}.badge{width:${width}mm;min-height:${height}mm;padding:5mm;display:flex;flex-direction:${layout === "a6" ? "column" : "row"};align-items:center;justify-content:center;gap:4mm;break-after:page;break-inside:avoid}.badge:last-child{break-after:auto}.badge img{width:${qr}mm;height:${qr}mm;flex-shrink:0}.name{font-size:${layout === "a6" ? 22 : 16}pt;font-weight:bold;overflow-wrap:anywhere}@media screen{body{background:#eee}.badge{background:white;margin:10px auto;box-shadow:0 1px 5px #aaa}}
</style></head><body>${badges.map((badge) => `<section class="badge" aria-label="Attendee badge"><img alt="Attendee badge QR code" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(badge.svg)}"><div><div class="name">${escapeHtml(badge.displayName)}</div></div></section>`).join("")}</body></html>`;
}

export function badgePrintCsv(badges: readonly FreshBadgePrint[]): string {
  const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return [
    "Name,Credential,Reference",
    ...badges.map((badge) => [badge.displayName, badge.credential, badge.id].map(cell).join(",")),
  ].join("\r\n");
}

export function downloadBadgeArtifact(content: string, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Let the browser consume the download before releasing the transient URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
