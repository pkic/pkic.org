/**
 * The screen page's watchdog, bundled on its own so it runs even when the
 * page's code fails to load: it hands the device back to its local status
 * page when a script cannot load, or when the page is still not ready after
 * a minute and a half.
 */
import { handOffScreen, SCREEN_HANDOFF, SCREEN_READY_ATTRIBUTE } from "./screen-handoff";

const ready = () => document.documentElement.hasAttribute(SCREEN_READY_ATTRIBUTE);

window.addEventListener(
  "error",
  (event) => {
    if (event.target instanceof HTMLScriptElement && !ready()) handOffScreen();
  },
  true,
);
setTimeout(() => {
  if (!ready()) handOffScreen();
}, SCREEN_HANDOFF.notReadyMs);
