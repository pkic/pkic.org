import { splitBadgePrintSvg } from "./badge-print-svg";
import { BADGE_TEXT_FIT_CHARACTER_EM } from "./badge-template-text-fit";
import type { badgePrintResponseSchema } from "./schemas/route-contracts-event-badges";
import type { z } from "zod";

export type BadgeLabelContent = Pick<
  z.infer<typeof badgePrintResponseSchema>,
  "svg" | "displayName" | "firstName" | "lastName" | "jobTitle" | "organization"
>;

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!,
  );
}

/** Fit complete words into a bounded text band; all supplied text remains in the vector output. */
function textBand(value: string, y: number, width: number, height: number, maximum: number, bold = false) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { svg: "", endY: y };
  const em = BADGE_TEXT_FIT_CHARACTER_EM[bold ? "bold" : "regular"];
  let size = maximum;
  let lines: string[] = [];
  for (;;) {
    lines = [];
    for (const word of words) {
      const previous = lines.at(-1);
      if (previous && [...`${previous} ${word}`].length * size * em <= width)
        lines[lines.length - 1] = `${previous} ${word}`;
      else lines.push(word);
    }
    if (lines.length * size * 1.12 <= height && words.every((word) => [...word].length * size * em <= width)) break;
    size *= 0.95;
  }
  return {
    svg: lines
      .map(
        (line, index) =>
          `<text x="2" y="${y + size + index * size * 1.12}" font-size="${size}" font-weight="${bold ? 700 : 400}">${escapeXml(line)}</text>`,
      )
      .join(""),
    endY: y + lines.length * size * 1.12,
  };
}

/** One monochrome label, shared by browser printing and SVG downloads. No stored artwork or render job. */
export function badgeLabelSvg(badge: BadgeLabelContent, widthMm = 90.3, heightMm = 38): string {
  if (!(Number.isFinite(widthMm) && Number.isFinite(heightMm) && widthMm > 0 && heightMm > 0))
    throw new Error("Label dimensions must be positive.");
  const parts = splitBadgePrintSvg(badge.svg);
  const width = 90.3;
  const height = 38;
  const textWidth = 53;
  const firstName = badge.firstName?.trim() || (badge.lastName?.trim() ? "" : badge.displayName?.trim()) || "";
  const name = firstName || badge.lastName?.trim() || "Attendee name unavailable";
  const surname = firstName ? (badge.lastName ?? "") : "";
  const qr = parts?.qr ?? badge.svg;
  const first = textBand(name, 1.5, textWidth, 11, 9.2, true);
  const last = textBand(surname, 12.5, textWidth, 8, 6.2);
  const job = textBand(badge.jobTitle ?? "", 24, textWidth, 5.2, 3.2, true);
  const organizationTop = job.svg ? job.endY + 0.7 : 24;
  const organization = textBand(badge.organization ?? "", organizationTop, textWidth, 36 - organizationTop, 3.1);
  const text = first.svg + last.svg + job.svg + organization.svg;
  const code = parts
    ? `<text x="72.5" y="35" text-anchor="middle" font-family="monospace" font-size="2.85">${escapeXml(parts.code)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(badge.displayName ?? name)}"><rect width="${width}" height="${height}" fill="#fff"/><g fill="#000" font-family="Arial,Helvetica,sans-serif">${text}<image x="57.5" y="1.5" width="30" height="30" href="data:image/svg+xml;charset=utf-8,${escapeXml(encodeURIComponent(qr))}"/>${code}</g></svg>`;
}
