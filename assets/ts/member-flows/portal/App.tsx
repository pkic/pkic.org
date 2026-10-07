import { Button } from "../../ui/Button";
/**
 * Portal root — gates on identity authentication, then loads member profile
 * data only when the session advertises member capacity. Staff-only users can
 * therefore enter the portal without being granted member-only API access.
 */
import { useEffect, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import {
  scannerCollectorPath,
  clearScannerOfflineContexts,
  scannerTransportUnavailable,
} from "./sections/events/detail/scanner/scanner-offline-context";
import { getJson, postJson, ApiClientError } from "../../shared/api-client";
import {
  authStatus,
  clearUserSession,
  finishAuthCheck,
  isAuthed,
  portalSession,
  setAuthChecking,
  savePortalSession,
  saveProfile,
  clearMemberProfile,
  clearAuth,
  signedInWithLink,
  logoutNotice,
} from "./state";
import { Login } from "./shell/Login";
import { Alert } from "../../ui/Alert";
import { ConfirmDialogHost } from "../../components/ConfirmDialog";
import { PortalShell } from "./shell/PortalShell";
import { VerifyingOverlay } from "../../components/VerifyingOverlay";
import { myProfileSchema } from "../../../shared/schemas/me";
import { userAuthEstablishedResponseSchema, userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import {
  recordCanonicalSession,
  readActiveUserSession,
  readPendingUserLogout,
  subscribeUserSessionState,
} from "../../shared/pending-user-logout";
import { resumePendingUserLogout, signOutPortalSession } from "./logout-session";
import { SponsorAccess } from "./sections/sponsors/Access";
import { portalHashPath, portalMagicLinkReturnPath, portalMagicLinkToken } from "./hash-route";
import { IdentityInvitationAcceptance } from "./shell/IdentityInvitationAcceptance";
import { usePortalHashLocation } from "./hash-location";
import { portalDefaultPath } from "./shell/portal-navigation";
import type { PortalSession } from "./types";
import { McpAuthorization } from "./shell/McpAuthorization";
import { meetingEntryReturnUrl } from "../../../shared/meeting-entry-navigation";
import { MeetingEntryReturn } from "./shell/MeetingEntryReturn";
import { useSessionExpiry } from "./use-session-expiry";
import { useSessionActivity } from "./use-session-activity";
const OfflineScannerBootstrap = lazy(() =>
  import("./sections/events/detail/scanner/OfflineScannerBootstrap").then((module) => ({
    default: module.OfflineScannerBootstrap,
  })),
);

async function verifyMagicLink(token: string): Promise<PortalSession> {
  const session = await postJson("/api/v1/auth/verify-link", { token }, userAuthEstablishedResponseSchema);
  if (!(await recordCanonicalSession({ sessionId: session.sessionId, operatorUserId: session.identity.id })))
    throw new Error("This session was signed out on this device.");
  savePortalSession(session);
  return session;
}

export function App() {
  const [portalPath] = usePortalHashLocation();
  const isMcpAuthorization = portalPath === "/auth/oauth";
  const isIdentityInvitation = portalPath === "/identity-invitations";
  const [verifying, setVerifying] = useState(() => Boolean(portalMagicLinkToken(window.location.hash)));
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [reauthenticating, setReauthenticating] = useState(false);

  async function loadPortalSession(): Promise<boolean> {
    scannerTransportUnavailable.value = false;
    setSessionError(null);
    const checkedSessionId = portalSession.value?.sessionId;
    let checkedLocalSession: Awaited<ReturnType<typeof readActiveUserSession>> = null;
    try {
      checkedLocalSession = await readActiveUserSession();
      const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
      if (!(await recordCanonicalSession({ sessionId: session.sessionId, operatorUserId: session.identity.id }))) {
        if (portalSession.value?.sessionId === session.sessionId) clearAuth();
        finishAuthCheck();
        return portalSession.value !== null;
      }
      if (portalSession.value?.identity.id !== session.identity.id) clearMemberProfile();
      savePortalSession(session);
      if (session.member) {
        const nextProfile = await getJson("/api/v1/users/current", myProfileSchema);
        if (portalSession.value === session) saveProfile(nextProfile);
      } else {
        clearMemberProfile();
      }
    } catch (error) {
      if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
        await clearScannerOfflineContexts(checkedLocalSession).catch(() => {
          setSessionError("Local scanner preparation could not be cleared. Reconnect before scanning.");
        });
        if (portalSession.value?.sessionId === checkedSessionId) clearUserSession();
      } else {
        scannerTransportUnavailable.value =
          error instanceof ApiClientError && error.status === 0 && error.code === "NETWORK_UNAVAILABLE";
        setSessionError("We could not refresh your sign-in information. Keep this page open and try again shortly.");
      }
    }

    finishAuthCheck();
    return portalSession.value !== null;
  }

  useSessionExpiry();
  useSessionActivity();

  async function restartSignIn(): Promise<void> {
    setSessionError(null);
    setReauthenticating(true);
    try {
      const session = portalSession.value;
      if (session) await signOutPortalSession(session);
    } catch {
      setSessionError("Local sign-out could not be saved. Keep this page open and try again.");
    } finally {
      setReauthenticating(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      if (isMcpAuthorization) return;
      if (isIdentityInvitation) {
        finishAuthCheck();
        return;
      }
      setAuthChecking();
      if (await resumePendingUserLogout()) {
        clearAuth();
        setVerifying(false);
        return;
      }
      const userToken = portalMagicLinkToken(window.location.hash);
      if (userToken) {
        try {
          const session = await verifyMagicLink(userToken);
          // Recorded before the redirect below rewrites the hash: after that
          // there is nothing left on the page saying this session began with a
          // link rather than with a passkey.
          signedInWithLink.value = true;
          // Session establishment may have restored a recorded return path;
          // only replace the hash when it still carries the verify token. The
          // link itself may name where to land — the route the sign-in began
          // on — and that wins over the session's default page.
          if (portalHashPath(window.location.hash) === "/verify") {
            const next = portalMagicLinkReturnPath(window.location.hash);
            history.replaceState({}, "", `/portal/#${next ?? portalDefaultPath(session)}`);
          }
        } catch (err) {
          if (!cancelled) {
            setVerifyError(
              err instanceof ApiClientError ? err.message : "The link may have expired or already been used.",
            );
            setVerifying(false);
            clearAuth();
            return;
          }
        }
        if (!cancelled) setVerifying(false);
      }
      if (!cancelled) await loadPortalSession();
    }

    void run().catch(() => {
      if (!cancelled) {
        clearAuth();
        setVerifying(false);
        setSessionError("Local sign-out information could not be checked. Keep this page open and try again.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isMcpAuthorization, isIdentityInvitation]);

  useEffect(() => {
    async function changed() {
      scannerTransportUnavailable.value = false;
      const current = portalSession.value;
      if (!current) return;
      try {
        const pending = await readPendingUserLogout();
        const active = await readActiveUserSession();
        if (portalSession.value?.sessionId !== current.sessionId) return;
        if (pending?.sessionId === current.sessionId || active?.sessionId !== current.sessionId) clearAuth();
      } catch {
        if (portalSession.value?.sessionId === current.sessionId) clearAuth();
      }
    }
    async function reconnect() {
      if (!(await resumePendingUserLogout()) && !portalSession.value) await loadPortalSession();
    }
    const unsubscribe = subscribeUserSessionState(() => {
      void changed();
    });
    window.addEventListener("online", reconnect);
    return () => {
      scannerTransportUnavailable.value = false;
      unsubscribe();
      window.removeEventListener("online", reconnect);
    };
  }, []);

  if (isMcpAuthorization) {
    return <McpAuthorization />;
  }

  if (isIdentityInvitation) {
    return <IdentityInvitationAcceptance />;
  }

  if (verifying || authStatus.value === "loading") {
    return <VerifyingOverlay />;
  }

  const pendingNotice =
    !isAuthed.value && logoutNotice.value ? (
      <Alert tone="info" title="Sign-out status">
        {logoutNotice.value}
      </Alert>
    ) : null;
  const sessionNotice = sessionError ? (
    <Alert tone="warn" title="Could not check sign-in">
      <p>{sessionError}</p>
      <Button variant="secondary" onClick={() => void loadPortalSession()}>
        Check sign-in again
      </Button>
    </Alert>
  ) : null;
  const collectorRoute = scannerCollectorPath(window.location.hash);
  if (sessionError && !isAuthed.value && scannerTransportUnavailable.value && collectorRoute)
    return (
      <div class="pk pk-stack">
        <Suspense fallback={<VerifyingOverlay />}>
          <OfflineScannerBootstrap route={collectorRoute} onCheckSignIn={() => void loadPortalSession()} />
        </Suspense>
      </div>
    );
  if (sessionError && !isAuthed.value) return <div class="pk pk-stack">{sessionNotice}</div>;

  if (isAuthed.value) {
    const meetingDestination = meetingEntryReturnUrl(window.location.hash);
    if (meetingDestination) return <MeetingEntryReturn destination={meetingDestination} />;
    return (
      <>
        {pendingNotice}
        {sessionNotice}
        {portalSession.value?.staffReauthenticationRequired && (
          <Alert tone="warn" title="Administrator access expired">
            <p>You are still signed in with your other portal access. Sign in again to restore administrator access.</p>
            <Button variant="secondary" loading={reauthenticating} onClick={() => void restartSignIn()}>
              Sign out and sign in again
            </Button>
          </Alert>
        )}
        <PortalShell key={`${portalSession.value?.identity.id}:${portalSession.value?.member?.identityId ?? ""}`} />
        <ConfirmDialogHost />
      </>
    );
  }

  if (portalHashPath(window.location.hash).startsWith("/sponsors")) {
    return (
      <>
        {verifyError && (
          // Laid out like the panel it sits above, so the banner and the card
          // share one measure. The cross that used to lead the sentence is
          // gone: `Alert`'s danger tone already carries role="alert", and the
          // title says what failed in words.
          <div class="pk pk-container pk-section pk-cluster pk-cluster--center">
            <div class="content-width-sm">
              <Alert tone="danger" title="Sponsor access failed">
                {verifyError}
              </Alert>
            </div>
          </div>
        )}
        {pendingNotice}
        <SponsorAccess />
      </>
    );
  }

  return (
    <>
      {verifyError && (
        <div class="pk pk-container pk-section pk-cluster pk-cluster--center">
          <div class="content-width-sm">
            <Alert tone="danger" title="Sign-in failed">
              {verifyError}
            </Alert>
          </div>
        </div>
      )}
      {pendingNotice}
      <Login
        onSignedIn={async () => {
          await loadPortalSession();
        }}
      />
    </>
  );
}
