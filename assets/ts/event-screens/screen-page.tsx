/**
 * The venue screen page's entry: reads the screen ID from the fragment and
 * shows the screen's own status. Pairing, assignment and the outputs it
 * shows once assigned build on this page.
 */
import { render } from "preact";
import "../../design/fonts.css";
import "../../design/tokens.generated.css";
import "../../design/tokens.event.generated.css";
import "../../design/utilities.css";
import { parseScreenPageAddress } from "./screen-address";
import { ScreenPairing } from "./ScreenStatus";
import "./screen-page.css";

function mount(): void {
  const host = document.getElementById("live-screen");
  if (!host) return;
  const address = parseScreenPageAddress(window.location);
  // Without a screen ID there is nothing to pair; the local status page opens this page with one.
  render(
    address ? (
      <main data-live-screen>
        <ScreenPairing screenId={address.screenId} pairing={null} />
      </main>
    ) : null,
    host,
  );
}

window.addEventListener("hashchange", mount);
mount();
