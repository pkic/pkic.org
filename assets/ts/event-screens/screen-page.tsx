/**
 * The venue screen page's entry: reads the screen ID from the fragment and
 * runs the screen on a clock corrected to the server's. A render it cannot
 * recover from hands the device back to its local status page.
 */
import { Component, render, type ComponentChildren } from "preact";
import "../../design/fonts.css";
import "../../design/fonts-mono.css";
import "../../design/tokens.generated.css";
import "../../design/tokens.event.generated.css";
import "../../design/utilities.css";
import { LiveClockContext } from "../live-session/useLiveCountdown";
import { parseScreenPageAddress } from "./screen-address";
import { createScreenClock } from "./screen-clock";
import { handOffScreen } from "./screen-handoff";
import { ScreenApp } from "./ScreenApp";
import "./screen-page.css";

class ScreenRecovery extends Component<{ children: ComponentChildren }> {
  componentDidCatch() {
    handOffScreen();
  }
  render() {
    return this.props.children;
  }
}

const clock = createScreenClock();

function mount(): void {
  const host = document.getElementById("live-screen");
  if (!host) return;
  const address = parseScreenPageAddress(window.location);
  // Without a screen ID there is nothing to pair; the device's status page opens this page with one.
  render(
    address ? (
      <main data-live-screen>
        <ScreenRecovery>
          <LiveClockContext.Provider value={clock.now}>
            <ScreenApp
              key={address.screenId}
              screenId={address.screenId}
              storage={window.localStorage}
              clock={clock}
              onHandoff={handOffScreen}
            />
          </LiveClockContext.Provider>
        </ScreenRecovery>
      </main>
    ) : null,
    host,
  );
}

window.addEventListener("hashchange", mount);
mount();
