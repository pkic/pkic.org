import { useEffect } from "preact/hooks";
import { splitHash } from "../../../../../../../ui/url-query";

/**
 * Holds the studio while its scene has unsaved changes. Closing or reloading
 * the page asks the browser first. Going to another portal page, by a link,
 * Back or the address bar, puts the studio's address back and calls `ask`,
 * which goes on once the changes are saved or discarded. A change to the
 * studio's own address query, such as a tab, is not leaving.
 */
export function useHoldUnsavedScene(unsaved: boolean, ask: (go: () => void) => void): void {
  useEffect(() => {
    if (!unsaved) return;
    const path = splitHash().path;
    let here = location.href;
    let leaving = false;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const moved = () => {
      if (leaving) return;
      if (splitHash().path === path) {
        here = location.href;
        return;
      }
      const to = location.href;
      // The portal reads the address as it redraws, so the studio stays until the changes are settled.
      history.replaceState(history.state, "", here);
      ask(() => {
        leaving = true;
        history.pushState(null, "", to);
        dispatchEvent(new HashChangeEvent("hashchange", { oldURL: here, newURL: to }));
      });
    };
    addEventListener("beforeunload", unload);
    addEventListener("hashchange", moved);
    return () => {
      removeEventListener("beforeunload", unload);
      removeEventListener("hashchange", moved);
    };
  }, [unsaved, ask]);
}
