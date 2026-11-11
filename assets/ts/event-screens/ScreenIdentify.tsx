import type { ScreenId } from "../../shared/schemas/event-screens";
import { LiveOverlayFrame } from "../live-session/LiveOverlayFrame";
import "./ScreenIdentify.css";

/** A screen manager asked which screen this is: its name and ID, over the picture, for a few seconds. */
export function ScreenIdentify({ screenId, name }: { screenId: ScreenId; name: string | null }) {
  return (
    <div class="pk-screen-identify" role="status">
      <LiveOverlayFrame view="screen-identify">
        <div class="pk-screen-identify__card">
          {name ? <p class="pk-screen-identify__name">{name}</p> : null}
          <p class="pk-screen-identify__id">{screenId}</p>
        </div>
      </LiveOverlayFrame>
    </div>
  );
}
