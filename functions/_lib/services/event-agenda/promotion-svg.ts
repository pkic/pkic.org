import { promotionFooterTexts, promotionFooterArrows } from "./promotion-footer";
import { promotionImageCover } from "./promotion-image";
import { svgLogoDimensions } from "../../utils/svg-logo";
import QRCode from "qrcode";
import { DEFAULT_PROMOTION_COLORS } from "../../../../assets/shared/schemas/event-promotion-design";
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
export function promotionSceneSvg(
  data: Pick<
    PromotionRenderData,
    "registrationUrl" | "design" | "composition" | "logoDataUrl" | "heroImage" | "measure"
  >,
  page: PromotionPage,
  includeText = true,
) {
  const e = promotionEscape,
    { width: w, height: h } = page;
  const social = page.social;
  const still = page.still;
  const panoramaIndex = page.carousel ? page.index : 0;
  const panoramaTotal = page.carousel ? page.total : 1;
  const motifBottom = still ? h - still.bandTop : 0;
  const motifHeight = still?.motifHeight ?? 170;
  const motifWidth = (506 * motifHeight) / 170;
  const hero = data.heroImage
    ? promotionImageCover(data.heroImage, w, social?.bandTop ?? h, social?.focalPoint ?? { x: 0.5, y: 0.5 })
    : null;
  const colors = data.design?.colors ?? DEFAULT_PROMOTION_COLORS;
  const stops = colors
    .map(
      (color, i) =>
        `<stop offset="${colors.length === 4 ? [0, 0.28, 0.66, 1][i] : i / (colors.length - 1)}" stop-color="${color}"/>`,
    )
    .join("");
  const asset = (key: "logo" | "mark" | "motif" | "texture") => {
    if (social && key !== "logo") return undefined;
    const value = data.design?.assets[key];
    return value ? `data:${value.mime};base64,${value.base64}` : undefined;
  };
  const logo = asset("logo") ?? data.logoDataUrl;
  const motif = asset("motif"),
    texture = asset("texture"),
    mark = asset("mark");
  const textureSize = texture?.startsWith("data:image/svg+xml;")
    ? svgLogoDimensions(atob(texture.slice(texture.indexOf(",") + 1)))
    : null;
  const tiledTexture = texture && (!textureSize || (textureSize.width <= 100 && textureSize.height <= 100));
  const picture = (
    src: string,
    x: number,
    y: number,
    width: number,
    height: number,
    circle = false,
    id = "picture",
    ringColor = "url(#portrait-accent)",
    ringWidth = social ? 8 : 7,
  ) =>
    `${circle ? `<defs><clipPath id="${id}"><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${width / 2}"/></clipPath></defs><circle cx="${x + width / 2}" cy="${y + height / 2}" r="${width / 2 + ringWidth}" fill="${ringColor}"/>${!src ? `<circle cx="${x + width / 2}" cy="${y + height / 2}" r="${width / 2}" fill="#174b42"/>` : ""}` : ""}${src ? `<image href="${e(src)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${circle ? "xMidYMid slice" : "xMidYMid meet"}"${circle ? ` clip-path="url(#${id})"` : ""}/>` : ""}`;
  const scale = w / 1080,
    bold = data.composition?.overlap === "bold";
  const qrSize = still ? (h < 800 ? 72 : 120) * scale : 120;
  const qrX = still ? w - (h < 800 ? 80 : 96) * scale - qrSize : w - 180;
  const qrY = still ? still.bandTop + (h - still.bandTop - qrSize) / 2 : h - 160;
  const text = includeText
    ? [...page.texts, ...promotionFooterTexts(page, data.registrationUrl, data.measure)]
        .map(
          (t) =>
            `<text x="${t.x}" y="${t.y}" font-family="${t.mono ? "Roboto Mono" : "Roboto, Noto Emoji"}" font-size="${t.size}" font-weight="${t.weight ?? (t.bold ? 700 : 400)}"${t.letterSpacing ? ` letter-spacing="${t.letterSpacing}"` : ""} fill="${t.color ?? (page.light ? "#0b0d0c" : "#fff")}"${t.anchor ? ` text-anchor="${t.anchor}"` : ""}>${e(t.text)}</text>`,
        )
        .join("")
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${e(page.title)}"><defs><linearGradient id="panorama" gradientUnits="userSpaceOnUse" x1="${-panoramaIndex * w}" y1="0" x2="${(panoramaTotal - panoramaIndex) * w}" y2="${h * 0.2}">${stops}</linearGradient><linearGradient id="title-accent"><stop stop-color="#198754"/><stop offset=".5" stop-color="#5a9bd5"/><stop offset="1" stop-color="#ed7d31"/></linearGradient><linearGradient id="portrait-accent" x2="1" y2="1"><stop stop-color="#198754"/><stop offset=".5" stop-color="#5a9bd5"/><stop offset="1" stop-color="#ed7d31"/></linearGradient><linearGradient id="social-scrim" x2="${w === h ? 0 : 1}" y2="${w === h ? 1 : 0}">${w === h ? `<stop stop-color="#0b2a1c" stop-opacity=".55"/><stop offset=".35" stop-color="#0b2a1c" stop-opacity=".25"/><stop offset=".62" stop-color="#0b2a1c" stop-opacity=".88"/><stop offset="1" stop-color="#0b2a1c" stop-opacity=".96"/>` : `<stop stop-color="#0b2a1c" stop-opacity=".95"/><stop offset=".4" stop-color="#0b2a1c" stop-opacity=".86"/><stop offset=".68" stop-color="#123c46" stop-opacity=".45"/><stop offset="1" stop-color="#12283c" stop-opacity=".25"/>`}</linearGradient><linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="${-panoramaIndex * w}" x2="${(panoramaTotal - panoramaIndex) * w}"><stop stop-color="#198754"/><stop offset=".5" stop-color="#5a9bd5"/><stop offset="1" stop-color="#ed7d31"/></linearGradient><linearGradient id="sponsor-accent" x2="0" y2="1"><stop stop-color="#198754"/><stop offset=".5" stop-color="#5a9bd5"/><stop offset="1" stop-color="#ed7d31"/></linearGradient><linearGradient id="grid-fade" x1="0" y1="0" x2="0" y2="${h}" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".45" stop-color="#fff" stop-opacity=".35"/><stop offset="${still ? ".6" : ".75"}" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="grid-mask"><rect width="${w}" height="${h}" fill="url(#grid-fade)"/></mask><radialGradient id="light" gradientUnits="userSpaceOnUse" cx="${-panoramaIndex * w}" cy="0" r="1400" gradientTransform="scale(1 .785714)"><stop stop-color="#fff" stop-opacity=".16"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/></radialGradient>${tiledTexture ? `<pattern id="texture" width="48" height="48" patternUnits="userSpaceOnUse" x="${-panoramaIndex * w}"><image href="${e(texture)}" width="48" height="48"/></pattern>` : ""}${motif ? `<pattern id="motif" y="${h - motifBottom - motifHeight}" width="${motifWidth}" height="${motifHeight}" patternUnits="userSpaceOnUse" x="${-panoramaIndex * w}"><image href="${e(motif)}" width="${motifWidth}" height="${motifHeight}"/></pattern>` : ""}</defs><rect width="${w}" height="${h}" fill="url(#panorama)"/>${hero ? `<svg width="${w}" height="${social?.bandTop ?? h}" viewBox="0 0 ${w} ${social?.bandTop ?? h}" overflow="hidden"><image href="${e(data.heroImage!.dataUrl)}" x="${hero.x}" y="${hero.y}" width="${hero.width}" height="${hero.height}" preserveAspectRatio="xMidYMid meet" opacity="${social ? 1 : 0.2}"/></svg>` : ""}${social ? `<rect width="${w}" height="${h}" fill="url(#social-scrim)"/>` : `<rect width="${w}" height="${h}" fill="url(#light)"/>`}${tiledTexture ? `<rect width="${w}" height="${h}" fill="url(#texture)" opacity=".25" mask="url(#grid-mask)"/>` : texture ? `<g mask="url(#grid-mask)" opacity=".5">${picture(texture, 0, 0, w, textureSize ? (w * textureSize.height) / textureSize.width : h)}</g>` : ""}${motif && data.composition?.motif !== false ? `<rect y="${h - motifBottom - motifHeight}" width="${w}" height="${motifHeight}" fill="url(#motif)" opacity="1"/>` : ""}${mark && page.markX !== undefined ? `<g opacity="1">${picture(mark, page.markX, (bold ? -160 : -100) * scale, (bold ? 560 : 460) * scale, (bold ? 577 : 474) * scale)}</g>` : ""}${still ? `<rect y="${still.bandTop}" width="${w}" height="${h - still.bandTop}" fill="#ffffff"/>` : ""}${page.sponsorBoard ? `<rect x="${page.sponsorBoard.x}" y="${page.sponsorBoard.y}" width="${page.sponsorBoard.width}" height="${page.sponsorBoard.height}" fill="#fff"/><rect x="${page.sponsorBoard.x}" y="${page.sponsorBoard.y}" width="${10 * scale}" height="${page.sponsorBoard.height}" fill="url(#sponsor-accent)"/>` : ""}${(page.rules ?? []).map((rule) => `<rect x="${rule.x}" y="${rule.y}" width="${rule.width}" height="1" fill="#e1e5e3"/>`).join("")}${logo && (page.index === 0 || still) ? (social ? picture(logo, 72, w === h ? 64 : 60, w === h ? 182 : 167, w === h ? 48 : 44) : page.carousel ? picture(logo, 88, 88, 232, 60) : still ? picture(logo, (h < 800 ? 80 : 96) * scale, still.logoY, 201 * scale, still.logoHeight) : picture(logo, 80, 35, 235, 62)) : ""}${page.pictures.map((p, i) => picture(p.src, p.x, p.y, p.width, p.height, p.circle, `portrait-${i}`, p.ringColor, p.ringWidth)).join("")}${(page.bars ?? []).map((bar) => `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" fill="${bar.color}" opacity="${bar.opacity ?? 1}"/>`).join("")}${[...(page.arrows ?? []), ...promotionFooterArrows(page)].map((arrow) => `<path d="M${arrow.x} ${arrow.y}h${arrow.length}m-5 -5l5 5l-5 5" stroke="${arrow.color}" stroke-width="2" fill="none"/>`).join("")}${social ? `<a href="${e(data.registrationUrl)}">${text}</a>` : text}${page.qr ? promotionQrSvg(data.registrationUrl, qrX, qrY, qrSize) : ""}${page.carousel ? `<rect x="${page.index === 0 ? 88 : 0}" y="1128" width="${w - (page.index === 0 ? 88 : 0) - (page.index === page.total - 1 ? 88 : 0)}" height="6" fill="url(#accent)"/>` : ""}</svg>`;
}
