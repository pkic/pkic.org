import { Button } from "../../ui/Button";
import { ScannerCodePreparation } from "./sections/events/detail/scanner/scanner-code-preparation";
import { prepareScannerDecoder } from "./sections/events/detail/scanner/prepareScannerDecoder";
import { registerPortalServiceWorker } from "./portal-worker-registration";
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
import { VerifyingOverlay } from "../../components/VerifyingOverlay";
import { myProfileSchema } from "../../../shared/schemas/me";
import { userAuthEstablishedResponseSchema, userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import {
  recordCanonicalSession,
  readActiveUserSession,
  readPendingUserLogout,
  subscribeUserSessionState,
} from "../../shared/pending-user-logout";
import { resumePendingUserLogout } from "./logout-session";
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
const PortalShell = lazy(() => import("./shell/PortalShell").then((module) => ({ default: module.PortalShell })));
const loadOfflineScannerBootstrap = () => import("./sections/events/detail/scanner/OfflineScannerBootstrap");
const OfflineScannerBootstrap = lazy(() =>
  loadOfflineScannerBootstrap().then((module) => ({ default: module.OfflineScannerBootstrap })),
);
const prepareOfflineScannerCode = (signal: AbortSignal) => prepareScannerDecoder(signal, loadOfflineScannerBootstrap);

async function verifyMagicLink(token: string, isCurrent: () => boolean): Promise<PortalSession | null> {
  const session = await postJson("/api/v1/auth/verify-link", { token }, userAuthEstablishedResponseSchema);
  if (!isCurrent()) return null;
  if (!(await recordCanonicalSession({ sessionId: session.sessionId, operatorUserId: session.identity.id })))
    throw new Error("This session was signed out on this device.");
  if (!isCurrent()) return null;
  savePortalSession(session);
  return session;
}

export function App() {
  useEffect(() => {
    // Public shell preparation is independent of sign-in, scanner diagnostics, and push enrollment.
    void registerPortalServiceWorker().catch(() => {});
  }, []);
  const [portalPath] = usePortalHashLocation();
  const magicLinkToken = portalMagicLinkToken(window.location.hash);
  const isMcpAuthorization = portalPath === "/auth/oauth";
  const isIdentityInvitation = portalPath === "/identity-invitations";
  const [verifying, setVerifying] = useState(() => Boolean(portalMagicLinkToken(window.location.hash)));
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  async function loadPortalSession(isCurrent: () => boolean = () => true): Promise<boolean> {
    if (!isCurrent()) return portalSession.value !== null;
    scannerTransportUnavailable.value = false;
    setSessionError(null);
    const checkedSessionId = portalSession.value?.sessionId;
    let checkedLocalSession: Awaited<ReturnType<typeof readActiveUserSession>> = null;
    try {
      checkedLocalSession = await readActiveUserSession();
      if (!isCurrent()) return portalSession.value !== null;
      const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
      if (!isCurrent()) return portalSession.value !== null;
      const recorded = await recordCanonicalSession({
        sessionId: session.sessionId,
        operatorUserId: session.identity.id,
      });
      if (!isCurrent()) return portalSession.value !== null;
      if (!recorded) {
        if (portalSession.value?.sessionId === session.sessionId) clearAuth();
        finishAuthCheck();
        return portalSession.value !== null;
      }
      if (portalSession.value?.identity.id !== session.identity.id) clearMemberProfile();
      savePortalSession(session);
      if (session.member) {
        const nextProfile = await getJson("/api/v1/users/current", myProfileSchema);
        if (isCurrent() && portalSession.value === session) saveProfile(nextProfile);
      } else {
        clearMemberProfile();
      }
    } catch (error) {
      if (!isCurrent()) return portalSession.value !== null;
      if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
        await clearScannerOfflineContexts(checkedLocalSession).catch(() => {
          if (isCurrent())
            setSessionError("Local scanner preparation could not be cleared. Reconnect before scanning.");
        });
        if (!isCurrent()) return portalSession.value !== null;
        if (portalSession.value?.sessionId === checkedSessionId) clearUserSession();
      } else {
        scannerTransportUnavailable.value =
          error instanceof ApiClientError && error.status === 0 && error.code === "NETWORK_UNAVAILABLE";
        setSessionError("We could not refresh your sign-in information. Keep this page open and try again shortly.");
      }
    }

    if (isCurrent()) finishAuthCheck();
    return portalSession.value !== null;
  }

  useSessionExpiry();
  useSessionActivity();

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      if (isMcpAuthorization) return;
      if (isIdentityInvitation) {
        finishAuthCheck();
        return;
      }
      setVerifying(Boolean(magicLinkToken));
      setVerifyError(null);
      setAuthChecking();
      const pendingLogout = await resumePendingUserLogout();
      if (cancelled) return;
      if (pendingLogout) {
        clearAuth();
        setVerifying(false);
        return;
      }
      const userToken = magicLinkToken;
      if (userToken) {
        try {
          const session = await verifyMagicLink(userToken, () => !cancelled);
          if (!session || cancelled) return;
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
          // Token removal owns the canonical session refresh in the next effect.
          setVerifying(false);
          return;
        } catch (err) {
          if (!cancelled) {
            setVerifying(false);
            // A link opened twice is refused the second time, but the first
            // opening may already have signed this browser in: check the
            // session before saying sign-in failed.
            const signedIn = await loadPortalSession(() => !cancelled);
            if (cancelled) return;
            if (signedIn && portalSession.value && portalHashPath(window.location.hash) === "/verify") {
              const next = portalMagicLinkReturnPath(window.location.hash);
              history.replaceState({}, "", `/portal/#${next ?? portalDefaultPath(portalSession.value)}`);
            } else if (!signedIn) {
              setVerifyError(
                err instanceof ApiClientError ? err.message : "The link may have expired or already been used.",
              );
            }
            return;
          }
        }
        if (!cancelled) setVerifying(false);
      }
      if (!cancelled) await loadPortalSession(() => !cancelled);
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
  }, [isMcpAuthorization, isIdentityInvitation, magicLinkToken]);

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
    return (
      <Login
        busy
        status={verifying ? "Verifying your sign-in link…" : "Checking your sign-in…"}
        onSignedIn={async () => {
          await loadPortalSession();
        }}
      />
    );
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
  if (sessionError && !isAuthed.value)
    return (
      <Login
        notice={
          <>
            {pendingNotice}
            {sessionNotice}
          </>
        }
        onSignedIn={async () => {
          await loadPortalSession();
        }}
      />
    );

  if (isAuthed.value) {
    const meetingDestination = meetingEntryReturnUrl(window.location.hash);
    if (meetingDestination) return <MeetingEntryReturn destination={meetingDestination} />;
    return (
      <>
        {pendingNotice}
        {sessionNotice}
        <ScannerCodePreparation.Provider value={prepareOfflineScannerCode}>
          <Suspense fallback={<Login busy status="Opening your portal…" onSignedIn={() => {}} />}>
            <PortalShell key={`${portalSession.value?.identity.id}:${portalSession.value?.member?.identityId ?? ""}`} />
          </Suspense>
        </ScannerCodePreparation.Provider>
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
    <Login
      notice={
        <>
          {verifyError && (
            <Alert tone="danger" title="Sign-in failed">
              {verifyError}
            </Alert>
          )}
          {pendingNotice}
        </>
      }
      onSignedIn={async () => {
        await loadPortalSession();
      }}
    />
  );
}
