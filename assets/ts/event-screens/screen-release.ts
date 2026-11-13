import { PKIC_RELEASE } from "../../shared/release";

const RELOADED_FOR_KEY = "pkic.screen.reloadedForRelease";

/**
 * After a deploy, a screen still runs the page it loaded before it, which
 * may no longer read what the server sends. When the server names another
 * release than the page's, the screen loads the page again, once per server
 * release: a page that still differs afterwards, such as one a cache served,
 * never reloads in a loop. Without a release on either side, nothing happens.
 */
export function reloadForServerRelease(
  serverRelease: string | null,
  storage: Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
  pageRelease: string = PKIC_RELEASE,
): boolean {
  if (!serverRelease || serverRelease === "dev" || pageRelease === "dev" || serverRelease === pageRelease) return false;
  try {
    if (storage.getItem(RELOADED_FOR_KEY) === serverRelease) return false;
    storage.setItem(RELOADED_FOR_KEY, serverRelease);
  } catch {
    // Without a place to note the reload, it could repeat: the screen keeps the page it has.
    return false;
  }
  reload();
  return true;
}
