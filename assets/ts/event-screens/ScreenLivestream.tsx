import type { ComponentChildren } from "preact";
import { LiveOverlayFrame } from "../live-session/LiveOverlayFrame";
import "./ScreenLivestream.css";

/**
 * The room's livestream, edge to edge on the screen, breaks included. While
 * the player has failed, the reconnecting card covers it as the screen keeps
 * trying; the player stays underneath so the card leaves as soon as it plays.
 */
export function ScreenLivestream({
  reconnectingRoom = null,
  aside,
  children,
}: {
  /** The room's name while the player is failing; null while it plays. */
  reconnectingRoom?: string | null;
  /** The screen's status, over everything in its corner. */
  aside?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <LiveOverlayFrame view="screen-livestream">
      <div class="pk-screen-livestream">
        <div class="pk-screen-livestream__player">{children}</div>
        {reconnectingRoom !== null && (
          <div class="pk-screen-livestream__reconnecting">
            <section class="pk-screen-livestream__card" aria-label={reconnectingRoom}>
              <p class="pk-screen-livestream__room">{reconnectingRoom}</p>
              <p class="pk-screen-livestream__status" role="status">
                Reconnecting to the livestream…
              </p>
            </section>
          </div>
        )}
        {aside}
      </div>
    </LiveOverlayFrame>
  );
}
