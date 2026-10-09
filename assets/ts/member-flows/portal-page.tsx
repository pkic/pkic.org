/**
 * Member portal entry point, mounted at /portal/ (data-module="member-flows/portal-page").
 *
 * Turned this from a single read-only profile screen into a
 * real multi-section portal (nav shell + My Profile edit + Account Settings
 * incl. passkeys + My Application) — see assets/ts/member-flows/portal/ for
 * the shell, sections, and state. This file is kept as the mount point so
 * layouts/portal/single.html's data-module attribute and loader.ts's module
 * map don't need to change.
 */
import "../../scss/portal-entry.scss";
import { render } from "preact";
import { capturePortalWorkerPageAssets } from "./portal/portal-worker-release";
import { App } from "./portal/App";
import { installPortalApiInterceptors } from "./portal/state";

installPortalApiInterceptors();

const mount = document.getElementById("portal-app");
if (mount) {
  // The loaded module fingerprint includes the portal import graph. Publish it
  // before App requests offline preparation; the worker has its own fingerprint.
  capturePortalWorkerPageAssets(import.meta.url);
  render(<App />, mount);
}
