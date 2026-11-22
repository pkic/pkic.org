import { eventVirtualRoomRoute } from "../../shared/event-participation-link";
import { QrGraphic } from "../components/qr/QrGraphic";
import "./LiveGraphicTheme.css";
import "./LiveQrCard.css";

/**
 * The scene's QR code: it opens this session in the event app, where people
 * ask questions and vote, so it needs no setup. A scene that shows it draws it
 * whenever the scene is on air. Without the event (a sample) it opens the app.
 */
export function LiveQrCodeOverlay({ eventSlug, occurrenceId }: { eventSlug: string | null; occurrenceId: string }) {
  const route = eventSlug ? `#${eventVirtualRoomRoute(eventSlug, { session: occurrenceId })}` : "";
  const url = new URL(`/portal/${route}`, window.location.origin).toString();
  return (
    <div class="pk-live-qr-card" data-graphic-theme="event">
      <QrGraphic url={url} label="Code to ask questions in the event app" caption="Scan to ask a question and vote" />
    </div>
  );
}
