import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { useDialogQueryState } from "../../../../../../hooks/useDialogQueryState";
import type { ComponentChildren } from "preact";
import "./PromotionGallery.css";

/**
 * One ready-to-post picture in a promotion gallery: a small preview, what it is
 * for, and its download. The preview frame keeps one height for every format,
 * so a tall story and a wide post line up in the same row.
 */
export function PromotionTile({
  name,
  detail,
  previewSrc,
  previewId,
  previewAlt,
  pending,
  stacked,
  status,
  action,
  previewActions,
}: {
  name: string;
  detail: string;
  previewSrc?: string;
  previewId?: string;
  previewAlt: string;
  /** Shown in the frame while the picture is not ready. */
  pending?: string;
  /** Draws the preview as the first of several slides. */
  stacked?: boolean;
  status?: string;
  action?: ComponentChildren;
  previewActions?: ComponentChildren;
}) {
  const [open, show, close] = useDialogQueryState(`promotionPreview:${previewId ?? name}`);
  return (
    <li class="pk-promotion-tile">
      {previewSrc ? (
        <Button
          variant="ghost"
          class={`pk-promotion-tile__frame${stacked ? " pk-promotion-tile__frame--stacked" : ""}`}
          aria-label={`Enlarge ${name.toLowerCase()}`}
          title={`Enlarge ${name.toLowerCase()}`}
          onClick={show}
        >
          <img src={previewSrc} alt={previewAlt} loading="lazy" decoding="async" />
        </Button>
      ) : (
        <div class="pk-promotion-tile__frame">
          <span class="pk-promotion-tile__pending">{pending}</span>
        </div>
      )}
      {previewSrc && open && (
        <Dialog
          open={open}
          viewer
          size="wide"
          title={name}
          closeLabel="Close preview"
          confirmLabel="Close"
          onConfirm={() => void close()}
          onCancel={() => void close()}
        >
          {previewActions}
          <img class="pk-promotion-preview" src={previewSrc} alt={previewAlt} />
        </Dialog>
      )}
      <div class="pk-promotion-tile__caption">
        <span class="pk-promotion-tile__text">
          <span class="pk-promotion-tile__name">{name}</span>
          <span class="pk-promotion-tile__detail">{detail}</span>
          <span role="status">{status}</span>
        </span>
        {action}
      </div>
    </li>
  );
}
