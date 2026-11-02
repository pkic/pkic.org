import { USER_HEADSHOT_PATH } from "../../../../assets/shared/headshot-variants";
import { currentUserHeadshotResponse } from "../user-headshot";
import type { Env } from "../../types";
import { resolveHeroImageSource, fetchStaticAsset } from "../og-badge-hero-image";
import { readBoundedStream } from "../../utils/bounded-stream";
import { svgRasterImage } from "../../utils/svg-raster-image";
import type { PromotionRenderData } from "./promotion-render";
/** Resolve current profile portraits through their canonical service; optional images remain bounded. */
export async function promotionPortraits(
  env: Env,
  origin: string,
  data: PromotionRenderData,
): Promise<Record<string, string>> {
  const people = data.people ?? data.occurrence.history?.appearances ?? [];
  const output: Record<string, string> = {};
  for (let offset = 0; offset < people.length; offset += 4)
    await Promise.all(
      people.slice(offset, offset + 4).map(async (person) => {
        if (!person.photoUrl) return;
        const source = resolveHeroImageSource(person.photoUrl, origin, env.HERO_IMAGE_ALLOWED_HOSTS);
        if (!source) return;
        try {
          const signal = AbortSignal.timeout(800);
          const headshot = USER_HEADSHOT_PATH.exec(new URL(source.url).pathname);
          const response =
            headshot && source.assetPath
              ? await currentUserHeadshotResponse(
                  env.DB,
                  env,
                  decodeURIComponent(headshot[1]!),
                  decodeURIComponent(headshot[2]!),
                  { width: "384", origin },
                )
              : source.assetPath
                ? await fetchStaticAsset(env, origin, source.assetPath, signal)
                : await fetch(source.url, { signal, redirect: "manual" });
          if (!response.ok || !response.body) return;
          const result = await readBoundedStream(response.body, 256 * 1024, "Portrait exceeds export byte budget");
          if (!result.ok) return;
          const image = await svgRasterImage(result.bytes, env.IMAGES, 256 * 1024);
          if (!image || image.width * image.height > 512 * 512) return;
          output[person.userId] = image.dataUrl;
        } catch {
          /* Optional portrait failure must not block approved copy. */
        }
      }),
    );
  return output;
}
