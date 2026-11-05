import { promotionResourcePath } from "./promotion-kit-client";
import { useEffect, useRef, useState } from "preact/hooks";
import { z } from "zod";
import {
  type promotionKitSchema,
  type promotionFormatSchema,
} from "../../../../../../../shared/schemas/event-promotion-kit";
import { requestJson } from "../../../../../../shared/api-client";
import { downloadFile } from "../../../../../../shared/download-file";
import { exportPromotionImages } from "./promotion-browser-export";
import { type PreparedPromotionArtwork } from "./usePromotionArtwork";

type Kit = z.infer<typeof promotionKitSchema>;
type Format = z.infer<typeof promotionFormatSchema>;

export function usePromotionDownloads(base: string, kit: Kit | null) {
  const [error, setError] = useState("");
  const [pdfPending, setPdfPending] = useState(false);
  const active = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setError("");
    setPdfPending(false);
    return () => controller.abort();
  }, [base, kit?.fingerprint]);

  async function download(format: Format, prepared?: PreparedPromotionArtwork) {
    if (!kit || kit.stale) return;
    const signal = active.current.signal;
    try {
      setError("");
      let content: Blob;
      if (format !== "carousel") {
        if (!prepared || prepared.artwork.fingerprint !== kit.fingerprint)
          throw new Error("The preview is unavailable. Refresh this page and try again.");
        content = await exportPromotionImages(prepared.artwork, prepared.urls);
      } else {
        setPdfPending(true);
        content = await requestJson(promotionResourcePath(base, "artifact"), z.instanceof(Blob), {
          method: "POST",
          signal,
          responseType: "blob",
          body: JSON.stringify({
            fingerprint: kit.fingerprint,
            publishedRevision: kit.publishedRevision,
            compositionRevision: kit.compositionRevision,
          }),
        });
      }
      signal.throwIfAborted();
      const extension = content.type === "application/zip" ? "zip" : content.type === "application/pdf" ? "pdf" : "jpg";
      downloadFile(content, content.type, `promotion-${format}.${extension}`);
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not download these materials. Try again.");
    } finally {
      if (!signal.aborted && format === "carousel") setPdfPending(false);
    }
  }
  return { download, error, pdfPending };
}
