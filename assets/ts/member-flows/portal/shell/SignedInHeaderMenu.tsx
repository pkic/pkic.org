/**
 * The site header's account menu on the steps between signing in and entering
 * the portal (choosing an identity, the passkey offer) and on the consent an
 * MCP client asks for.
 *
 * Those steps share the sign-in card, so without this the header still offers
 * "Sign in" and the person can read the step as being sent back to sign in.
 * The menu names who is signed in and lets a wrong account sign out there.
 */
import { createPortal } from "preact/compat";

import { AccountMenu } from "../../../ui/AccountMenu";
import { accountDisplayName, profile } from "../state";
import type { PortalSession } from "../types";

export function SignedInHeaderMenu({ session }: { session: PortalSession }) {
  const mount = document.getElementById("pkic-account-menu");
  if (!mount) return null;
  return createPortal(
    <AccountMenu
      session={session}
      displayName={accountDisplayName(profile.value)}
      headshotUrl={profile.value?.headshotUrl ?? null}
      navigate={(path) => {
        window.location.hash = path;
      }}
    />,
    mount,
  );
}
