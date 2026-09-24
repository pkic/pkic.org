import { render } from "preact";
import { App } from "./meeting-join/App";
import {
  consumeMeetingGuestInvitationFragment,
  parsePersonalMeetingLinkFragment,
} from "./meeting-join/invitation-fragment";

// The Worker validates the short invitation path and redirects here with the
// token in a fragment. It identifies the invitee but never authenticates them.
const personalToken = parsePersonalMeetingLinkFragment(window.location.hash);
// Legacy guest capabilities do authenticate, so remove those from history.
const invitation = personalToken ? null : consumeMeetingGuestInvitationFragment(window.location, window.history);
const mount = document.getElementById("meeting-join-app");
if (mount) {
  mount.replaceChildren();
  render(<App invitation={invitation} personalToken={personalToken} />, mount);
}
