/**
 * The screen page's entry. A venue screen device opens it with its screen ID
 * and runs as a device. A browser without an ID offers to set itself up as a
 * screen, then runs as a browser screen with the ID it keeps; the address
 * says which (see `parseScreenPageAddress`). Each runs on a clock corrected to the server's. A render it cannot
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
import { browserScreenAddress, parseScreenPageAddress } from "./screen-address";
import { createScreenClock } from "./screen-clock";
import { handOffScreen } from "./screen-handoff";
import { screenStorage } from "./screen-storage";
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
/** This browser's storage, or this visit's where the browser refuses it. */
const storage = screenStorage();
/** One per page, so what the setup click granted carries into the screen it becomes. */
let browser: BrowserScreen | null = null;

function mount(): void {
  const host = document.getElementById("live-screen");
  if (!host) return;
  const { screenId, host: runsOn } = parseScreenPageAddress(window.location);
  if (runsOn === "browser") browser ??= createBrowserScreen();
  // A device without an ID has nothing to pair; its status page opens this page with one.
  if (runsOn === "device" && !screenId) {
    render(null, host);
    return;
  }
  if (!screenId) {
    render(
      <main data-live-screen>
        <BrowserScreenEnroll
          browser={browser!}
          onEnrolled={() => {
            window.location.hash = browserScreenAddress(browserScreenId(storage));
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
            storage={storage}
            clock={clock}
            onHandoff={handOffScreen}
            browser={runsOn === "browser" ? browser : null}
          />
        </LiveClockContext.Provider>
      </ScreenRecovery>
    </main>,
    host,
  );
}

window.addEventListener("hashchange", mount);
mount();
