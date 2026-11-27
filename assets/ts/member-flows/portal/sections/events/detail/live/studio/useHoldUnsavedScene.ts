import { useLayoutEffect } from "preact/hooks";
import { splitHash } from "../../../../../../../ui/url-query";

/**
 * Holds the studio while its scene has unsaved changes. Closing or reloading
 * the page asks the browser first. Going to another portal page, by a link,
 * Back or the address bar, puts the studio's address back and calls `ask`,
 * which goes on once the changes are saved or discarded. A change to the
 * studio's own address query, such as a tab, is not leaving.
 */
export function useHoldUnsavedScene(unsaved: boolean, ask: (go: () => void) => void): void {
  // Held as soon as the change draws, not a frame later, so an immediate Back still asks.
  useLayoutEffect(() => {
    if (!unsaved) return;
    const path = splitHash().path;
    let here = location.href;
    let leaving = false;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const moved = (event: Event) => {
      if (leaving) return;
      if (splitHash().path === path) {
        here = location.href;
        return;
      }
      const to = location.href;
      // Back, Forward and the address bar say popstate; a portal link says only hashchange.
      const traversed = event.type === "popstate";
      // The portal reads the address as it redraws, so the studio stays until the changes are settled.
      // After Back or Forward the studio goes on top, so the page gone to keeps its own place in history.
      if (traversed) history.pushState(null, "", here);
      else history.replaceState(history.state, "", here);
      ask(() => {
        leaving = true;
        if (traversed) {
          history.back();
          return;
        }
        history.pushState(null, "", to);
        dispatchEvent(new HashChangeEvent("hashchange", { oldURL: here, newURL: to }));
      });
    };
    // Back and Forward say popstate before hashchange, and the portal redraws from either. The browser
    // redraws between one listener and the next, so the studio listens first, in the capture phase.
    const moves = ["popstate", "hashchange"] as const;
    addEventListener("beforeunload", unload);
    for (const event of moves) addEventListener(event, moved, true);
    return () => {
      removeEventListener("beforeunload", unload);
      for (const event of moves) removeEventListener(event, moved, true);
    };
  }, [unsaved, ask]);
}
