import QRCode from "qrcode";
import type { PromotionPage } from "./promotion-scene";
import type { PromotionRenderData } from "./promotion-render";
export const promotionEscape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!,
  );
export function promotionQrSvg(url: string, x: number, y: number, size: number) {
  const code = QRCode.create(url, { errorCorrectionLevel: "M" }),
    unit = size / (code.modules.size + 8);
  let cells = "";
  for (let row = 0; row < code.modules.size; row++)
    for (let col = 0; col < code.modules.size; col++)
      if (code.modules.get(row, col))
        cells += `<rect x="${x + (col + 4) * unit}" y="${y + (row + 4) * unit}" width="${unit}" height="${unit}"/>`;
  return `<g fill="#0b0d0c"><rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff"/>${cells}</g>`;
}
/** The same scene, optionally without text for the PDF's decorative background. */
export function promotionSceneSvg(data: PromotionRenderData, page: PromotionPage, includeText = true) {
  const e = promotionEscape,
    { width: w, height: h } = page;
  const colors = data.design?.colors ?? ["#0b2a1c", "#125c3c", "#20506e", "#b0581f"];
  const stops = colors.map((color, i) => `<stop offset="${i / (colors.length - 1)}" stop-color="${color}"/>`).join("");
  const asset = (key: "logo" | "mark" | "motif" | "texture") => {
    const value = data.design?.assets[key];
    return value ? `data:${value.mime};base64,${value.base64}` : undefined;
  };
  const logo = asset("logo") ?? data.logoDataUrl;
  const motif = asset("motif"),
    texture = asset("texture"),
    mark = asset("mark");
  const picture = (src: string, x: number, y: number, width: number, height: number, circle = false, id = "picture") =>
    `${circle ? `<defs><clipPath id="${id}"><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${width / 2}"/></clipPath></defs><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${width / 2 + 7}" fill="url(#accent)"/>` : ""}<image href="${e(src)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${circle ? "xMidYMid slice" : "xMidYMid meet"}"${circle ? ` clip-path="url(#${id})"` : ""}/>`;
  const footer = h - (h < 800 ? 55 : 180);
  const scale = w / 1080,
    bold = data.composition?.overlap === "bold";
  const text = includeText
    ? page.texts
        .map(
          (t) =>
            `<text x="${t.x}" y="${t.y}" font-family="Roboto, Noto Emoji" font-size="${t.size}" font-weight="${t.bold ? 700 : 400}" fill="${t.color ?? (page.light ? "#0b0d0c" : "#fff")}">${e(t.text)}</text>`,
        )
        .join("")
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${e(page.title)}"><defs><linearGradient id="panorama" gradientUnits="userSpaceOnUse" x1="${-page.index * w}" y1="0" x2="${(page.total - page.index) * w}" y2="${h * 0.2}">${stops}</linearGradient><linearGradient id="accent"><stop stop-color="#198754"/><stop offset=".5" stop-color="#5a9bd5"/><stop offset="1" stop-color="#ed7d31"/></linearGradient><linearGradient id="sponsor-accent" x2="0" y2="1"><stop stop-color="#198754"/><stop offset=".5" stop-color="#5a9bd5"/><stop offset="1" stop-color="#ed7d31"/></linearGradient><radialGradient id="light"><stop stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>${texture ? `<pattern id="texture" width="48" height="48" patternUnits="userSpaceOnUse" x="${-page.index * w}"><image href="${e(texture)}" width="48" height="48"/></pattern>` : ""}${motif ? `<pattern id="motif" width="506" height="170" patternUnits="userSpaceOnUse" x="${-page.index * w}"><image href="${e(motif)}" width="506" height="170"/></pattern>` : ""}</defs><rect width="${w}" height="${h}" fill="url(#panorama)"/><rect width="${w}" height="${h}" fill="url(#light)"/>${texture ? `<rect width="${w}" height="${h * 0.7}" fill="url(#texture)" opacity=".2"/>` : ""}${motif && data.composition?.motif !== false ? `<rect y="${h - 170}" width="${w}" height="170" fill="url(#motif)"/>` : ""}${mark && page.markX !== undefined ? picture(mark, page.markX, (bold ? -160 : -100) * scale, (bold ? 560 : 460) * scale, (bold ? 577 : 474) * scale) : ""}${page.sponsorBoard ? `<rect x="${page.sponsorBoard.x}" y="${150 * scale}" width="${page.sponsorBoard.width}" height="${h - 360 * scale}" fill="#fff"/><rect x="${page.sponsorBoard.x}" y="${150 * scale}" width="${10 * scale}" height="${h - 360 * scale}" fill="url(#sponsor-accent)"/>` : ""}${(page.rules ?? []).map((rule) => `<rect x="${rule.x}" y="${rule.y}" width="${rule.width}" height="1" fill="#e1e5e3"/>`).join("")}${logo && page.index === 0 ? picture(logo, 80, 35, 235, 62) : ""}${page.pictures.map((p, i) => picture(p.src, p.x, p.y, p.width, p.height, p.circle, `portrait-${i}`)).join("")}${text}${page.qr ? promotionQrSvg(data.registrationUrl, w - 180, h - 160, 120) : ""}<rect x="80" y="${footer + 25}" width="${w - (page.qr ? 280 : 160)}" height="5" fill="url(#accent)"/>${includeText ? `<text x="80" y="${h < 800 ? h - 95 : h - 70}" font-family="Roboto" font-size="18" fill="#fff">${e(data.registrationUrl)}</text><text x="80" y="${footer}" font-family="Roboto" font-size="22" fill="#fff">${String(page.index + 1).padStart(2, "0")} / ${String(page.total).padStart(2, "0")}</text>${page.index === 0 && page.total > 1 ? `<text x="${w - 380}" y="${footer}" font-family="Roboto" font-size="22" fill="#fff">SWIPE</text>` : ""}` : ""}</svg>`;
}
