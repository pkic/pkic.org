import { usePromotionArtwork } from "./usePromotionArtwork";
import { usePromotionDownloads } from "./usePromotionDownloads";
import { useDialogQueryState } from "../../../../../../hooks/useDialogQueryState";
import { Alert } from "../../../../../../ui/Alert";
import { loadPromotionKit } from "./promotion-kit-client";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import {
  promotionKitSchema,
  type promotionFormatSchema,
} from "../../../../../../../shared/schemas/event-promotion-kit";
import { Panel, PanelBody } from "../../../../../../ui/Panel";
import { IconPencil } from "../../../../../../ui/MediaIcons";
import { Button } from "../../../../../../ui/Button";
import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { PromotionCompositionEditor } from "./PromotionCompositionEditor";
import { PromotionTile } from "./PromotionTile";
import { copyText } from "../../../../../../shared/clipboard";
import { toast } from "../../../../ui";
import "./PromotionGallery.css";
type Kit = z.infer<typeof promotionKitSchema>;
type Format = z.infer<typeof promotionFormatSchema>;

const tiles = [
  { format: "portrait", name: "Tall post", detail: "4:5 · JPEG", type: "JPEG" },
  { format: "square", name: "Square post", detail: "1:1 · JPEG", type: "JPEG" },
  { format: "landscape", name: "Wide post", detail: "1.91:1 · JPEG", type: "JPEG" },
  { format: "carousel", name: "Carousel", detail: "PDF slides", type: "PDF", stacked: true },
] satisfies readonly { format: Format; name: string; detail: string; type: string; stacked?: boolean }[];

export function PersonalPromotionKit({
  base,
  title,
  leading,
  menu,
}: {
  base: string;
  title: string;
  menu?: ComponentChildren;
  /** Tiles from outside this kit shown first, such as the attendee badge. */
  leading?: ComponentChildren;
}) {
  const [kit, setKit] = useState<Kit | null>(null),
    [error, setError] = useState("");
  const { previews, failures } = usePromotionArtwork(base, kit);
  const downloads = usePromotionDownloads(base, kit);
  const [editing, showEditing, closeEditing] = useDialogQueryState(`promotionComposition:${base}`);
  useEffect(() => {
    let cancelled = false;
    setKit(null);
    setError("");
    void loadPromotionKit(base)
      .then((value) => {
        if (!cancelled) setKit(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load promotion materials.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  return (
    <Panel aria-label={title}>
      <PanelBody>
        {(error || downloads.error) && <ErrorAlert error={error || downloads.error} />}
        {kit && (
          <div class="pk-stack">
            {kit.stale && (
              <Alert tone="warn">
                Some sessions in your materials are no longer on the agenda. Choose Customize to review them.
              </Alert>
            )}
            <ul class="pk-promotion-gallery">
              {leading}
              {tiles.map((tile) => {
                const loaded = previews[tile.format];
                const preview = !kit.stale && loaded?.artwork.fingerprint === kit.fingerprint ? loaded : undefined;
                const ready = !kit.stale && (tile.format === "carousel" || Boolean(preview));
                return (
                  <PromotionTile
                    key={tile.format}
                    previewId={`${base}:${tile.format}`}
                    name={tile.name}
                    detail={tile.detail}
                    stacked={"stacked" in tile}
                    previewSrc={preview?.urls[0]}
                    previewAlt={`Preview of your ${tile.name.toLowerCase()}`}
                    previewActions={
                      <Button
                        onClick={() =>
                          void copyText(
                            `${kit.source?.title ?? title}\n${kit.copy.whyAttend}\n${kit.registrationUrl}`,
                            { copied: "Post copied", failed: "Your browser could not copy the post", notify: toast },
                          )
                        }
                      >
                        Copy post
                      </Button>
                    }
                    pending={kit.stale ? "Review your session picks" : (failures[tile.format] ?? "Loading preview…")}
                    status={tile.format === "carousel" && downloads.pdfPending ? "Preparing PDF…" : undefined}
                    action={
                      <span class="pk-promotion-tile__actions">
                        {tile.format === "portrait" && menu}
                        <Button
                          icon
                          aria-label={`Customize ${tile.name.toLowerCase()}`}
                          title={`Customize ${tile.name.toLowerCase()}`}
                          onClick={showEditing}
                        >
                          <IconPencil />
                        </Button>
                        <DownloadAction
                          label={`Download ${tile.name.toLowerCase()} (${tile.type})`}
                          disabled={!ready}
                          onDownload={() => downloads.download(tile.format, preview)}
                        />
                      </span>
                    }
                  />
                );
              })}
            </ul>
            <PromotionCompositionEditor
              open={editing}
              key={kit.compositionRevision}
              kit={kit}
              base={base}
              onCancel={() => {
                void closeEditing().catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : "Could not close the editor."),
                );
              }}
              onSaved={(value) => {
                setKit(value);
                void closeEditing().catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : "Could not close the editor."),
                );
              }}
            />
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
