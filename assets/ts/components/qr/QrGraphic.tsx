/**
 * A QR code as a graphic: the code a phone camera opens, with an optional
 * name and line under it. It fills its container's width and sizes its text to
 * that width, like the live overlay graphics, so a page, a session screen and
 * a broadcast output can each place it at any size.
 */
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import { qrModulePath } from "../../../shared/qr-modules";
import "./QrGraphic.css";

export interface QrGraphicProps {
  /** The absolute link the code carries. */
  url: string;
  /** What the code opens, for assistive technology. */
  label: string;
  /** A name drawn under the code. */
  title?: string;
  /**
   * A line under the name, such as the instruction to scan. Rich content is
   * accepted so a caller can pass already sanitized inline Markdown; the
   * graphic never parses or sanitizes it.
   */
  caption?: ComponentChildren;
}

export function QrGraphic({ url, label, title, caption }: QrGraphicProps) {
  const qr = useMemo(() => qrModulePath(url), [url]);
  const hasCaption = caption !== undefined && caption !== null && caption !== false && caption !== "";
  return (
    // The outer box is the size container; the plate inside is sized by it, so spacing grows with the
    // graphic. Plain boxes, not figure and figcaption, which the public site's prose styles center and space.
    <div class="pk-qr-graphic">
      <div class="pk-qr-graphic__plate">
        <svg
          class="pk-qr-graphic__code"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          role="img"
          aria-label={label}
          shape-rendering="crispEdges"
        >
          <rect width={qr.size} height={qr.size} class="pk-qr-graphic__ground" />
          <path d={qr.path} class="pk-qr-graphic__modules" />
        </svg>
        {title || hasCaption ? (
          <div class="pk-qr-graphic__caption">
            {title ? <span class="pk-qr-graphic__label">{title}</span> : null}
            {hasCaption ? <span class="pk-qr-graphic__note">{caption}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
