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
  previewAlt,
  pending,
  stacked,
  action,
}: {
  name: string;
  detail: string;
  previewSrc?: string;
  previewAlt: string;
  /** Shown in the frame while the picture is not ready. */
  pending?: string;
  /** Draws the preview as the first of several slides. */
  stacked?: boolean;
  action?: ComponentChildren;
}) {
  return (
    <li class="pk-promotion-tile">
      <div class={`pk-promotion-tile__frame${stacked ? " pk-promotion-tile__frame--stacked" : ""}`}>
        {previewSrc ? (
          <img src={previewSrc} alt={previewAlt} loading="lazy" decoding="async" />
        ) : (
          <span class="pk-promotion-tile__pending">{pending}</span>
        )}
      </div>
      <div class="pk-promotion-tile__caption">
        <span class="pk-promotion-tile__text">
          <span class="pk-promotion-tile__name">{name}</span>
          <span class="pk-promotion-tile__detail">{detail}</span>
        </span>
        {action}
      </div>
    </li>
  );
}
