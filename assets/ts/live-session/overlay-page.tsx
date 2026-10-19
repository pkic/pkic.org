/**
 * The broadcast overlay page's entry: reads the output and layout from the
 * query and the room and access from the fragment, and renders that one
 * output, read-only.
 */
import { render } from "preact";
import "../../design/fonts.css";
import "../../design/tokens.generated.css";
import "../../design/tokens.event.generated.css";
// The shared visually hidden text, which the lower third's affiliation rotation uses for its labels.
import "../../design/utilities.css";
import { LiveProgramOverlay } from "./LiveProgramOverlay";
import { parseLiveOverlayAddress } from "./live-overlay-address";

function mount(): void {
  const host = document.getElementById("live-overlay");
  if (!host) return;
  const address = parseLiveOverlayAddress(window.location);
  // An incomplete link shows nothing: a broadcast must never carry an error message.
  render(
    address ? (
      <LiveProgramOverlay
        key={`${window.location.search}${window.location.hash}`}
        view={address.view}
        layout={address.layout}
        slug={address.slug}
        roomId={address.roomId}
        token={address.token}
      />
    ) : null,
    host,
  );
}

window.addEventListener("hashchange", mount);
mount();
