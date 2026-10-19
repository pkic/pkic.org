/**
 * One check-in code as a graphic: the QR code a phone camera opens, with the
 * point's name under it. It fills its container's width and sizes its text to
 * that width, like the live overlay graphics, so the organizer page, a session
 * screen and a broadcast output can each place it at any size.
 *
 * It draws a point the server already signed (`AttendancePoint.path`); it never
 * builds or signs a code itself. Which point to show is chosen with the shared
 * `attendancePointSelectionSchema`.
 */
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import type { AttendancePoint } from "../../../shared/schemas/event-attendance-points";
import { qrModulePath } from "../../../shared/qr-modules";
import { attendancePointUrl } from "./attendance-point-url";
import "./CheckInQrGraphic.css";

export interface CheckInQrGraphicProps {
  point: Pick<AttendancePoint, "label" | "path">;
  /**
   * A line under the name, such as the instruction to scan. Rich content is
   * accepted so a caller can pass already sanitized inline Markdown; the
   * graphic never parses or sanitizes it.
   */
  caption?: ComponentChildren;
  /**
   * Whether the point's name is drawn under the code. An output that already
   * names the session elsewhere hides it; the code keeps the name in its
   * accessible label either way.
   */
  showLabel?: boolean;
  /** The site the code opens; the current one unless an output renders for another origin. */
  origin?: string;
}

export function CheckInQrGraphic({ point, caption, showLabel = true, origin }: CheckInQrGraphicProps) {
  const url = attendancePointUrl(point.path, origin);
  const qr = useMemo(() => qrModulePath(url), [url]);
  const hasCaption = caption !== undefined && caption !== null && caption !== false && caption !== "";
  return (
    // The outer box is the size container; the plate inside is sized by it, so spacing grows with the
    // graphic. Plain boxes, not figure and figcaption, which the public site's prose styles center and space.
    <div class="pk-check-in-qr">
      <div class="pk-check-in-qr__plate">
        <svg
          class="pk-check-in-qr__code"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          role="img"
          aria-label={`Check-in code: ${point.label}`}
          shape-rendering="crispEdges"
        >
          <rect width={qr.size} height={qr.size} class="pk-check-in-qr__ground" />
          <path d={qr.path} class="pk-check-in-qr__modules" />
        </svg>
        {showLabel || hasCaption ? (
          <div class="pk-check-in-qr__caption">
            {showLabel ? <span class="pk-check-in-qr__label">{point.label}</span> : null}
            {hasCaption ? <span class="pk-check-in-qr__note">{caption}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
