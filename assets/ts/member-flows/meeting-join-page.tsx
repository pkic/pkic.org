import { render } from "preact";
import { App } from "./meeting-join/App";
import { consumeMeetingGuestInvitationFragment } from "./meeting-join/invitation-fragment";

// Strip the capability fragment before any application request is made. URL
// fragments are not sent on the initial page request, and this removes the
// credential from browser history before the app starts verification.
const invitation = consumeMeetingGuestInvitationFragment(window.location, window.history);
const mount = document.getElementById("meeting-join-app");
if (mount) render(<App invitation={invitation} />, mount);
