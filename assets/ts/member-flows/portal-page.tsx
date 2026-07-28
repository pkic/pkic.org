/**
 * Member portal entry point, mounted at /portal/ (data-module="member-flows/portal-page").
 *
 * PRD §11 UI-1 turned this from a single read-only profile screen into a
 * real multi-section portal (nav shell + My Profile edit + Account Settings
 * incl. passkeys + My Application) — see assets/ts/member-flows/portal/ for
 * the shell, sections, and state. This file is kept as the mount point so
 * layouts/portal/single.html's data-module attribute and loader.ts's module
 * map don't need to change.
 */
import { render } from "preact";
import { App } from "./portal/App";

const mount = document.getElementById("portal-app");
if (mount) render(<App />, mount);
