import { render } from "preact";
import { AccountMenu } from "./ui/AccountMenu";
import { getJson } from "./shared/api-client";
import { userAuthSessionResponseSchema } from "../shared/schemas/user-auth";
import { myProfileSchema } from "../shared/schemas/me";
import {
  recordCanonicalSession,
  readActiveUserSession,
  readPendingUserLogout,
  subscribeUserSessionState,
} from "./shared/pending-user-logout";
import { resumePendingUserLogout } from "./member-flows/portal/logout-session";
import {
  accountDisplayName,
  authStatus,
  portalSession,
  profile,
  savePortalSession,
  saveProfile,
  clearAuth,
  finishAuthCheck,
} from "./member-flows/portal/state";

function PublicAccountMenu() {
  const session = portalSession.value;
  if (authStatus.value !== "authenticated" || !session)
    return (
      <a class="pkic-nav-link pkic-nav-signin" href="/portal/">
        Sign in
      </a>
    );
  return (
    <AccountMenu
      session={session}
      displayName={accountDisplayName(profile.value)}
      headshotUrl={profile.value?.headshotUrl ?? null}
      navigate={(path) => window.location.assign(`/portal/#${path}`)}
    />
  );
}

/** Public pages share the durable sign-out fence; the portal owns its own session refresh. */
export async function installPublicAccountMenu(): Promise<void> {
  const mount = document.getElementById("pkic-account-menu");
  if (!mount || document.getElementById("portal-app")) return;
  render(<PublicAccountMenu />, mount);
  subscribeUserSessionState(() => {
    void Promise.all([readActiveUserSession(), readPendingUserLogout()])
      .then(([active, pending]) => {
        const current = portalSession.value;
        if (current && (active?.sessionId !== current.sessionId || pending?.sessionId === current.sessionId))
          clearAuth();
      })
      .catch(() => clearAuth());
  });
  try {
    if (await resumePendingUserLogout()) return;
    const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
    if (!(await recordCanonicalSession({ sessionId: session.sessionId, operatorUserId: session.identity.id }))) return;
    savePortalSession(session, { restoreReturnPath: false });
    const person = await getJson("/api/v1/users/current", myProfileSchema);
    if (portalSession.value === session) saveProfile(person);
  } catch {
    // An anonymous visitor or unavailable session service retains the sign-in entry.
  } finally {
    finishAuthCheck();
  }
}
