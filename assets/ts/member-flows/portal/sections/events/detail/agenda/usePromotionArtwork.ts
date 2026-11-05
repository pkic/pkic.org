import { promotionResourcePath } from "./promotion-kit-client";
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  promotionArtworkSchema,
  promotionFormatSchema,
  type promotionKitSchema,
} from "../../../../../../../shared/schemas/event-promotion-kit";
import { getJson } from "../../../../../../shared/api-client";
import { promotionArtworkUrls, type PromotionArtwork } from "./promotion-browser-export";

type Kit = z.infer<typeof promotionKitSchema>;
type Format = z.infer<typeof promotionFormatSchema>;
export type PreparedPromotionArtwork = { artwork: PromotionArtwork; urls: string[] };

export function usePromotionArtwork(base: string, kit: Kit | null) {
  const [previews, setPreviews] = useState<Partial<Record<Format, PreparedPromotionArtwork>>>({});
  const [failures, setFailures] = useState<Partial<Record<Format, string>>>({});
  const fingerprint = kit?.fingerprint;
  const revision = kit?.publishedRevision;
  const stale = kit?.stale;
  useEffect(() => {
    const controller = new AbortController();
    setPreviews({});
    setFailures({});
    if (fingerprint && revision && !stale) {
      for (const format of promotionFormatSchema.options) {
        void (async () => {
          const query = new URLSearchParams({
            format,
            revision: String(revision),
            fingerprint,
            representation: "artwork",
          });
          const artwork = await getJson(promotionResourcePath(base, "artifact", query), promotionArtworkSchema, {
            signal: controller.signal,
          });
          const sources = await promotionArtworkUrls(artwork);
          if (controller.signal.aborted) return;
          setPreviews((current) => ({ ...current, [format]: { artwork, urls: sources } }));
        })().catch((error: unknown) => {
          if (!controller.signal.aborted)
            setFailures((current) => ({
              ...current,
              [format]: error instanceof Error ? error.message : "Could not load this preview.",
            }));
        });
      }
    }
    return () => {
      controller.abort();
    };
  }, [base, fingerprint, revision, stale]);
  return { previews, failures };
}
