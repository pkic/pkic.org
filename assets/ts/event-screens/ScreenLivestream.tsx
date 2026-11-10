import type { ComponentChildren } from "preact";
import { LiveOverlayFrame } from "../live-session/LiveOverlayFrame";
import "./ScreenLivestream.css";

/** The room's livestream, edge to edge on the screen, breaks included. */
export function ScreenLivestream({ children }: { children: ComponentChildren }) {
  return (
    <LiveOverlayFrame view="screen-livestream">
      <div class="pk-screen-livestream">{children}</div>
    </LiveOverlayFrame>
  );
}

/** Shown only while the player has failed or the stream ended, as the screen keeps trying to reconnect. */
export function ScreenLivestreamReconnecting({ roomName }: { roomName: string }) {
  return (
    <LiveOverlayFrame view="screen-livestream">
      <div class="pk-screen-livestream" data-reconnecting>
        <section class="pk-screen-livestream__card" aria-label={roomName}>
          <p class="pk-screen-livestream__room">{roomName}</p>
          <p class="pk-screen-livestream__status" role="status">
            Reconnecting to the livestream…
          </p>
        </section>
      </div>
    </LiveOverlayFrame>
  );
}
