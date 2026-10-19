import type { Env } from "../../types";
import { resolveHeroImageSource, fetchStaticAsset, uint8ToBase64 } from "../og-badge-hero-image";
import { readBoundedStream } from "../../utils/bounded-stream";
import { validateRasterImage } from "../../utils/image-format";
import type { PromotionRenderData } from "./promotion-render";
/** Approved frozen portraits only; bounded optional assets fall back to initials. */
export async function promotionPortraits(
  env: Env,
  origin: string,
  data: PromotionRenderData,
): Promise<Record<string, string>> {
  const people = data.occurrence.history?.appearances ?? [];
  const output: Record<string, string> = {};
  for (let offset = 0; offset < people.length; offset += 4)
    await Promise.all(
      people.slice(offset, offset + 4).map(async (person) => {
        if (!person.photoUrl) return;
        const source = resolveHeroImageSource(person.photoUrl, origin, env.HERO_IMAGE_ALLOWED_HOSTS);
        if (!source) return;
        try {
          const signal = AbortSignal.timeout(800);
          const response = source.assetPath
            ? await fetchStaticAsset(env, origin, source.assetPath, signal)
            : await fetch(source.url, { signal, redirect: "manual" });
          if (!response.ok || !response.body) return;
          const result = await readBoundedStream(response.body, 256 * 1024, "Portrait exceeds export byte budget");
          if (!result.ok) return;
          const image = validateRasterImage(result.bytes);
          if (!image.ok || image.image.width * image.image.height > 512 * 512) return;
          output[person.userId] = `data:${image.image.contentType};base64,${uint8ToBase64(result.bytes)}`;
        } catch {
          /* Optional portrait failure must not block approved copy. */
        }
      }),
    );
  return output;
}
