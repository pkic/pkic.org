import { renderOverlayTextHtml } from "../../shared/overlay-text-template";
import type { LiveCheckInOnAir } from "../../shared/schemas/live-session-room";
import { CheckInQrGraphic } from "../components/attendance-points/CheckInQrGraphic";
import "./LiveGraphicTheme.css";
import "./LiveCheckInOverlay.css";

/**
 * The check-in code on a broadcast or room output, at its standard broadcast
 * size; the layout scales it to the element's box. The card, its words and
 * the code itself take the theme: black on white for any phone camera, or
 * white on transparent over a dark picture. The code keeps its quiet zone in
 * every theme.
 */
export function LiveCheckInOverlay({ checkIn }: { checkIn: LiveCheckInOnAir }) {
  const caption = checkIn.text.visible
    ? renderOverlayTextHtml(checkIn.text.template, { checkIn: { label: checkIn.label } })
    : "";
  return (
    <div class="pk-live-check-in" data-graphic-theme={checkIn.theme}>
      <CheckInQrGraphic
        point={checkIn}
        showLabel={false}
        caption={caption ? <span dangerouslySetInnerHTML={{ __html: caption }} /> : undefined}
      />
    </div>
  );
}
