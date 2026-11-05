import { promotionPortraits } from "./promotion-portraits";
import { promotionFontMeasure, hasUnsupportedPromotionScript } from "./promotion-text";
import { fetchStaticAsset, uint8ToBase64 } from "../og-badge-hero-image";
import { AppError } from "../../errors";
import type { Env } from "../../types";
import type { PromotionRenderData } from "./promotion-render";
import { PROMOTION_FONTS } from "../../../../assets/shared/promotion-fonts";

/**
 * Fonts and the logo are the same for every render, so an isolate working
 * through a queue loads them once. A failed load is forgotten,
 * so the next job tries again.
 */
const sharedInputs = new Map<string, Promise<Uint8Array | undefined>>();
function cachedInput(key: string, load: () => Promise<Uint8Array | undefined>) {
  let value = sharedInputs.get(key);
  if (!value) {
    value = load();
    value.catch(() => sharedInputs.delete(key));
    sharedInputs.set(key, value);
  }
  return value;
}
async function promotionFont(env: Env, origin: string, name: string) {
  const font = await cachedInput(`${origin}/fonts/${name}`, async () => {
    const response = await fetchStaticAsset(env, origin, `/fonts/${name}`);
    if (!response.ok)
      throw new AppError(503, "PROMOTION_FONT_UNAVAILABLE", "Promotion typography is temporarily unavailable.");
    return new Uint8Array(await response.arrayBuffer());
  });
  return font!;
}
/** Shared measured artwork inputs; no rasterization or document export is needed for a preview. */
export async function preparePromotionArtwork(env: Env, origin: string, data: PromotionRenderData) {
  const text = JSON.stringify([data.occurrence, data.copy, data.agenda.eventName]);
  if (hasUnsupportedPromotionScript(text))
    throw new AppError(
      409,
      "PROMOTION_SCRIPT_UNSUPPORTED",
      "Promotion cards are printed in Latin script. Use the English spelling of names and titles.",
    );
  const faces = PROMOTION_FONTS.filter(
    (face) => face.family !== "Noto Emoji" || /\p{Extended_Pictographic}/u.test(text),
  );
  const [fonts, logo, portraits] = await Promise.all([
    Promise.all(faces.map((face) => promotionFont(env, origin, face.file))),
    cachedInput(`${origin}/img/logo.svg`, async () => {
      const response = await fetchStaticAsset(env, origin, "/img/logo.svg");
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
    }),
    promotionPortraits(env, origin, data),
  ]);
  const fontAssets = { mono: fonts[2]!, monoBold: fonts[3]!, medium: fonts[4]! };
  return {
    faces,
    fonts,
    source: {
      ...data,
      fontAssets,
      portraits,
      logoDataUrl: logo ? `data:image/svg+xml;base64,${uint8ToBase64(logo)}` : undefined,
      measure: promotionFontMeasure(fonts, fontAssets),
    },
  };
}
