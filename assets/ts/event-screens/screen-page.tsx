/**
 * The screen page's entry. A venue screen device opens it with its screen ID
 * and its own marker, and runs as a device. Any other browser is a browser
 * screen: without an ID it offers to set itself up, then runs with the ID it
 * keeps. Each runs on a clock corrected to the server's. A render it cannot
 * recover from hands a device back to its local status page.
 */
import { Component, render, type ComponentChildren } from "preact";
import "../../design/fonts.css";
import "../../design/fonts-mono.css";
import "../../design/tokens.generated.css";
import "../../design/tokens.event.generated.css";
import "../../design/utilities.css";
import { LiveClockContext } from "../live-session/useLiveCountdown";
import { createBrowserScreen, type BrowserScreen } from "./browser-screen";
import { browserScreenId } from "./browser-screen-id";
import { BrowserScreenEnroll } from "./BrowserScreenEnroll";
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
/** One per page, so what the setup click granted carries into the screen it becomes. */
let browser: BrowserScreen | null = null;

function mount(): void {
  const host = document.getElementById("live-screen");
  if (!host) return;
  const { screenId, agent } = parseScreenPageAddress(window.location);
  if (!agent) browser ??= createBrowserScreen();
  // A device without an ID has nothing to pair; its status page opens this page with one.
  if (agent && !screenId) {
    render(null, host);
    return;
  }
  if (!screenId) {
    render(
      <main data-live-screen>
        <BrowserScreenEnroll
          browser={browser!}
          onEnrolled={() => {
            window.location.hash = new URLSearchParams({ id: browserScreenId(window.localStorage) }).toString();
          }}
        />
      </main>,
      host,
    );
    return;
  }
  render(
    <main data-live-screen>
      <ScreenRecovery>
        <LiveClockContext.Provider value={clock.now}>
          <ScreenApp
            key={screenId}
            screenId={screenId}
            storage={window.localStorage}
            clock={clock}
            onHandoff={handOffScreen}
            browser={agent ? null : browser}
          />
        </LiveClockContext.Provider>
      </ScreenRecovery>
    </main>,
    host,
  );
}

window.addEventListener("hashchange", mount);
mount();
