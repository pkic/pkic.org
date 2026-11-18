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
import type { AttendancePoint } from "../../../shared/schemas/event-attendance-points";
import { attendancePointUrl } from "./attendance-point-url";
import { QrGraphic } from "../qr/QrGraphic";

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
  return (
    <QrGraphic
      url={attendancePointUrl(point.path, origin)}
      label={`Check-in code: ${point.label}`}
      title={showLabel ? point.label : undefined}
      caption={caption}
    />
  );
}
