/**
 * Sponsor portal entry point, mounted at /sponsor-portal/
 * (data-module="member-flows/sponsor-portal-page"). See
 * assets/ts/member-flows/sponsor-portal/ for the App/Login/Attendees split.
 */
import { render } from "preact";
import { App } from "./sponsor-portal/App";

const mount = document.getElementById("sponsor-portal-app");
if (mount) render(<App />, mount);
