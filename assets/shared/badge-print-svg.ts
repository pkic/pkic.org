import { formatBadgeCredential } from "./schemas/badge-credential";

/** Keep the original QR intact and size its manual code for the 36 mm label image. */
export function composeBadgePrintSvg(svg: string, credential: string): string {
  const code = formatBadgeCredential(credential);
  const root = svg.match(/<svg\b[^>]*>/);
  const viewBox = root?.[0].match(/viewBox="0 0 ([0-9]+(?:\.[0-9]+)?) ([0-9]+(?:\.[0-9]+)?)"/);
  if (!root || !viewBox || (!svg.endsWith("</svg>\n") && !svg.endsWith("</svg>")))
    throw new Error("Could not prepare the badge QR for printing.");
  const qrWidth = Number(viewBox[1]);
  const qrHeight = Number(viewBox[2]);
  if (!(qrWidth > 0 && qrHeight > 0)) throw new Error("Could not prepare the badge QR for printing.");
  // Width governs the existing square print image; reserve a separate 7.2 mm text band.
  const width = Math.max(qrWidth, qrHeight / 0.8, 40);
  const footerHeight = width * 0.2;
  const height = qrHeight + footerHeight;
  const offset = (width - qrWidth) / 2;
  const pointsInMillimeters = 25.4 / 72;
  const codeFontSize = width * ((8.25 * pointsInMillimeters) / 36);
  const captionFontSize = width * ((6 * pointsInMillimeters) / 36);
  const opening = root[0].replace(viewBox[0], `viewBox="0 0 ${width} ${height}"`);
  const original = svg.slice((root.index ?? 0) + root[0].length, svg.lastIndexOf("</svg>"));
  const qr = `<g transform="translate(${offset} 0)">${original}</g>`;
  const text = `<g fill="#000" text-anchor="middle" font-family="monospace"><text x="${width / 2}" y="${qrHeight + width * 0.075}" font-size="${captionFontSize}">Badge code</text><text x="${width / 2}" y="${qrHeight + width * 0.18}" font-size="${codeFontSize}" textLength="${width * 0.9}" lengthAdjust="spacingAndGlyphs">${code}</text></g>`;
  return `${svg.slice(0, root.index ?? 0)}${opening}<rect width="${width}" height="${height}" fill="#fff"/>${qr}${text}</svg>`;
}

const COMPOSED = new RegExp(
  '^(<svg\\b[^>]*?)viewBox="0 0 ([0-9.]+) ([0-9.]+)"([^>]*)><rect [^>]*/><g transform="translate\\(([0-9.]+) 0\\)">([\\s\\S]*)</g>' +
    '<g fill="#000" text-anchor="middle" font-family="monospace"><text [^>]*>Badge code</text><text [^>]*>([A-Z0-9]{4}(?:-[A-Z0-9]{4}){3})</text></g></svg>$',
);

/**
 * The inverse of `composeBadgePrintSvg` for templates that place the manual code themselves: the untouched QR
 * (with its quiet zone) as a square SVG, and the formatted code. Anything else, such as a design preview's
 * placeholder, is not split.
 */
export function splitBadgePrintSvg(svg: string): { qr: string; code: string } | null {
  const match = COMPOSED.exec(svg.trim());
  if (!match) return null;
  const [, opening, widthText, heightText, rest, offsetText, original, code] = match;
  const [width, height, offset] = [Number(widthText), Number(heightText), Number(offsetText)];
  const qrWidth = width - 2 * offset;
  const qrHeight = height - width * 0.2;
  if (!(qrWidth > 0 && qrHeight > 0)) return null;
  return {
    qr: `${opening}viewBox="${offset} 0 ${qrWidth} ${qrHeight}"${rest}><g transform="translate(${offset} 0)">${original}</g></svg>`,
    code,
  };
}
