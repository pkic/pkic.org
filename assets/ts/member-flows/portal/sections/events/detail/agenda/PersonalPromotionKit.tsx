import { useDialogQueryState } from "../../../../../../hooks/useDialogQueryState";
import { Alert } from "../../../../../../ui/Alert";
import { downloadFile } from "../../../../../../shared/download-file";
import { loadPromotionKit } from "./promotion-kit-client";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  promotionKitSchema,
  type promotionFormatSchema,
} from "../../../../../../../shared/schemas/event-promotion-kit";
import { postJson, getBlob } from "../../../../../../shared/api-client";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Button } from "../../../../../../ui/Button";
import { CloseButton } from "../../../../../../ui/CloseButton";
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
const inFlight = ["queued", "rendering", "retrying"];

export function PersonalPromotionKit({
  base,
  title,
  leading,
  onClose,
}: {
  base: string;
  title: string;
  /** Tiles from outside this kit shown first, such as the attendee badge. */
  leading?: ComponentChildren;
  onClose?: () => void;
}) {
  const [kit, setKit] = useState<Kit | null>(null),
    [error, setError] = useState("");
  const requested = useRef(false);
  const [editing, showEditing, closeEditing] = useDialogQueryState(`promotionComposition:${base}`);
  useEffect(() => {
    let cancelled = false;
    setKit(null);
    requested.current = false;
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
  const prepare = useCallback(
    async (current: Kit) => {
      try {
        setKit(
          await postJson(
            `${base}/renders`,
            {
              fingerprint: current.fingerprint,
              publishedRevision: current.publishedRevision,
              compositionRevision: current.compositionRevision,
            },
            promotionKitSchema,
          ),
        );
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create your materials.");
      }
    },
    [base],
  );
  useEffect(() => {
    if (!kit || kit.stale) return;
    const missing = tiles.some((tile) =>
      [undefined, "obsolete"].includes(kit.artifacts.find((item) => item.format === tile.format)?.status),
    );
    if (missing && !requested.current) {
      requested.current = true;
      void prepare(kit);
      return;
    }
    if (!kit.artifacts.some((item) => inFlight.includes(item.status))) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadPromotionKit(base)
        .then((value) => {
          if (!cancelled) setKit(value);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Could not refresh your materials.");
        });
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kit, base, prepare]);
  async function download(format: Format) {
    try {
      const content = await getBlob(artifact(format));
      const extension =
        { "application/zip": "zip", "application/pdf": "pdf", "image/jpeg": "jpg" }[content.type] ?? "png";
      downloadFile(content, content.type, `promotion-${format}.${extension}`);
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not download these materials.");
    }
  }
  const artifact = (format: Format, preview = false) =>
    `${base}/artifact?format=${encodeURIComponent(format)}&revision=${kit!.publishedRevision}&fingerprint=${kit!.fingerprint}${preview ? "&download=false" : ""}`;
  const status = (format: Format) => kit?.artifacts.find((item) => item.format === format)?.status;
  return (
    <Panel>
      <PanelHeader title={title}>
        {kit && (
          <>
            <Button
              onClick={() =>
                void copyText(`${kit.source?.title ?? title}\n${kit.copy.whyAttend}\n${kit.registrationUrl}`, {
                  copied: "Post copied",
                  failed: "Your browser could not copy the post",
                  notify: toast,
                })
              }
            >
              Copy post
            </Button>
            <Button onClick={showEditing}>Customize</Button>
          </>
        )}
        {onClose && <CloseButton label="Close promotion materials" onClick={onClose} />}
      </PanelHeader>
      <PanelBody>
        {error && <ErrorAlert error={error} />}
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
                const ready = status(tile.format) === "rendered";
                return (
                  <PromotionTile
                    key={tile.format}
                    name={tile.name}
                    detail={tile.detail}
                    stacked={"stacked" in tile}
                    previewSrc={ready ? artifact(tile.format, true) : undefined}
                    previewAlt={`Preview of your ${tile.name.toLowerCase()}`}
                    pending={status(tile.format) === "failed" ? "Couldn't create this" : "Creating…"}
                    action={
                      <DownloadAction
                        label={`Download ${tile.name.toLowerCase()} (${tile.type})`}
                        disabled={!ready}
                        onDownload={() => download(tile.format)}
                      />
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
                requested.current = false;
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
