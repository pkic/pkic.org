import { PromotionBadgeTiles } from "./PromotionBadgeTile";
import { extractOgBadgeUrl } from "../../../../../../shared/widgets/share-panel";
import { usePromotionArtwork, loadPromotionArtwork } from "./usePromotionArtwork";
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
import { Toolbar } from "../../../../../../ui/Toolbar";
import { IconPencil } from "../../../../../../ui/MediaIcons";
import { Button } from "../../../../../../ui/Button";
import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { PromotionCompositionEditor } from "./PromotionCompositionEditor";
import { PromotionTile, type PromotionTileSelection } from "./PromotionTile";
import { copyText } from "../../../../../../shared/clipboard";
import { toast } from "../../../../ui";
import "./PromotionGallery.css";
type Kit = z.infer<typeof promotionKitSchema>;
type Format = z.infer<typeof promotionFormatSchema>;
type BadgeFormat = "badge-landscape" | "badge-square";

const tiles = [
  { format: "portrait", name: "Tall post", ratio: "4:5", type: "JPEG" },
  { format: "square", name: "Square post", ratio: "1:1", type: "JPEG" },
  { format: "landscape", name: "Wide post", ratio: "1.91:1", type: "JPEG" },
  { format: "carousel", name: "Carousel", ratio: "4:5", type: "PDF", stacked: true },
] satisfies readonly { format: Format; name: string; ratio: string; type: string; stacked?: boolean }[];

export function PersonalPromotionKit({
  base,
  title,
  leading,
  readOnly = false,
  menu,
  select,
}: {
  base: string;
  /** Lets an organizer pick files: the selection state of each format, given how to download it. */
  select?: (format: Format | BadgeFormat, download?: () => Promise<void>) => PromotionTileSelection;
  title: string;
  menu?: ComponentChildren;
  /** Tiles from outside this kit shown first, such as the attendee badge. */
  leading?: ComponentChildren;
  readOnly?: boolean;
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
  const attendeeBadgeUrl =
    kit?.audience === "attendee" && !leading ? extractOgBadgeUrl(kit.registrationUrl, kit.fingerprint) : null;
  return (
    <Panel aria-label={title}>
      <PanelBody class="pk-stack">
        {(error || downloads.error) && <ErrorAlert error={error || downloads.error} />}
        {kit && (
          <div class="pk-stack">
            {kit.stale && (
              <Alert tone="warn">
                Some sessions in your materials are no longer on the agenda. Choose Customize to review them.
              </Alert>
            )}
            <ul class="pk-promotion-gallery">
              {leading ?? (attendeeBadgeUrl && <PromotionBadgeTiles badgeUrl={attendeeBadgeUrl} select={select} />)}
              {tiles.map((tile) => {
                const loaded = previews[tile.format];
                const preview = !kit.stale && loaded?.artwork.fingerprint === kit.fingerprint ? loaded : undefined;
                const ready = !kit.stale && (tile.format === "carousel" || Boolean(preview));
                return (
                  <PromotionTile
                    key={`${tile.format}:${kit.fingerprint}`}
                    previewId={`${base}:${tile.format}`}
                    name={tile.name}
                    ratio={tile.ratio}
                    stacked={"stacked" in tile}
                    selection={
                      select && {
                        ...select(tile.format, ready ? () => downloads.download(tile.format, preview) : undefined),
                        disabled: !ready,
                      }
                    }
                    previewSrc={preview?.urls[0]}
                    loadSlides={
                      tile.format === "carousel"
                        ? (signal) =>
                            loadPromotionArtwork(base, kit, "carousel", "all", signal).then((result) => result.urls)
                        : undefined
                    }
                    previewAlt={`Preview of your ${tile.name.toLowerCase()}`}
                    previewActions={(dismiss) => (
                      <>
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
                        {!readOnly && (
                          <Button
                            icon
                            aria-label={`Customize ${tile.name.toLowerCase()}`}
                            title={`Customize ${tile.name.toLowerCase()}`}
                            onClick={() =>
                              void dismiss()
                                .then(showEditing)
                                .catch((cause: unknown) =>
                                  setError(cause instanceof Error ? cause.message : "Could not open the editor."),
                                )
                            }
                          >
                            <IconPencil />
                          </Button>
                        )}
                        <DownloadAction
                          label={`Download ${tile.name.toLowerCase()} (${tile.type})`}
                          disabled={!ready}
                          onDownload={() => downloads.download(tile.format, preview)}
                        />
                      </>
                    )}
                    pending={kit.stale ? "Review your session picks" : (failures[tile.format] ?? "Loading preview…")}
                    status={tile.format === "carousel" && downloads.pdfPending ? "Preparing PDF…" : undefined}
                    action={
                      <Toolbar label={`${tile.name} actions`}>
                        {!readOnly && (
                          <Button
                            icon
                            aria-label={`Customize ${tile.name.toLowerCase()}`}
                            title={`Customize ${tile.name.toLowerCase()}`}
                            onClick={showEditing}
                          >
                            <IconPencil />
                          </Button>
                        )}
                        <DownloadAction
                          label={`Download ${tile.name.toLowerCase()} (${tile.type})`}
                          disabled={!ready}
                          onDownload={() => downloads.download(tile.format, preview)}
                        />
                      </Toolbar>
                    }
                  />
                );
              })}
            </ul>
            {!readOnly && (
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
            )}
          </div>
        )}
        {menu && <Toolbar label="Session sharing actions">{menu}</Toolbar>}
      </PanelBody>
    </Panel>
  );
}
