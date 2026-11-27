import { eventVirtualRoomRoute } from "../../shared/event-participation-link";
import type { LiveQrLook } from "../../shared/schemas/live-overlay-layout";
import { QrGraphic } from "../components/qr/QrGraphic";
import "./LiveGraphicTheme.css";
import "./LiveQrCard.css";

/**
 * The scene's QR code: it opens this session in the event app, where people
 * ask questions and vote, so it needs no setup. A scene that shows it draws it
 * whenever the scene is on air. Without the event (a sample) it opens the app.
 * The scene picks its look: the card, or the code alone in its colors.
 */
export function LiveQrCodeOverlay({
  eventSlug,
  occurrenceId,
  look,
}: {
  eventSlug: string | null;
  occurrenceId: string;
  look: LiveQrLook;
}) {
  const route = eventSlug ? `#${eventVirtualRoomRoute(eventSlug, { session: occurrenceId })}` : "";
  const url = new URL(`/portal/${route}`, window.location.origin).toString();
  return (
    <div class="pk-live-qr-card" data-graphic-theme="event" data-look={look}>
      <QrGraphic
        url={url}
        label="Code to ask questions in the event app"
        caption={look === "card" ? "Scan to ask a question and vote" : undefined}
      />
    </div>
  );
}
