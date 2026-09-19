import { Button } from "../../ui/Button";
/**
 * Portal root — gates on identity authentication, then loads member profile
 * data only when the session advertises member capacity. Staff-only users can
 * therefore enter the portal without being granted member-only API access.
 */
import { useEffect, useState } from "preact/hooks";
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
} from "./state";
import { Login } from "./shell/Login";
import { Alert } from "../../ui/Alert";
import { ConfirmDialogHost } from "../../components/ConfirmDialog";
import { PortalShell } from "./shell/PortalShell";
import { VerifyingOverlay } from "../../components/VerifyingOverlay";
import { myProfileSchema } from "../../../shared/schemas/me";
import { userAuthEstablishedResponseSchema, userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import { SponsorAccess } from "./sections/sponsors/Access";
import { portalHashPath, portalMagicLinkReturnPath, portalMagicLinkToken } from "./hash-route";
import { portalDefaultPath } from "./shell/portal-navigation";
import type { PortalSession } from "./types";
import { McpAuthorization } from "./shell/McpAuthorization";
import { meetingEntryReturnUrl } from "../../../shared/meeting-entry-navigation";
import { MeetingEntryReturn } from "./shell/MeetingEntryReturn";
import { useSessionExpiry } from "./use-session-expiry";

async function verifyMagicLink(token: string): Promise<PortalSession> {
  const session = await postJson("/api/v1/auth/verify-link", { token }, userAuthEstablishedResponseSchema);
  savePortalSession(session);
  return session;
}

export function App() {
  useSessionExpiry();
  const isMcpAuthorization = portalHashPath(window.location.hash) === "/auth/oauth";
  const [verifying, setVerifying] = useState(() => Boolean(portalMagicLinkToken(window.location.hash)));
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  async function loadPortalSession(): Promise<boolean> {
    setSessionError(null);
    try {
      const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
      if (portalSession.value?.identity.id !== session.identity.id) clearMemberProfile();
      savePortalSession(session);
      if (session.member) {
        const nextProfile = await getJson("/api/v1/users/current", myProfileSchema);
        if (portalSession.value === session) saveProfile(nextProfile);
      } else {
        clearMemberProfile();
      }
    } catch (error) {
      if (error instanceof ApiClientError && [401, 403].includes(error.status)) clearUserSession();
      else setSessionError("We could not refresh your sign-in information. Keep this page open and try again shortly.");
    }

    finishAuthCheck();
    return portalSession.value !== null;
  }

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      if (isMcpAuthorization) return;
      setAuthChecking();
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

    void run();
    return () => {
      cancelled = true;
    };
  }, [isMcpAuthorization]);

  if (isMcpAuthorization) {
    return <McpAuthorization />;
  }

  if (verifying || authStatus.value === "loading") {
    return <VerifyingOverlay />;
  }

  const sessionNotice = sessionError ? (
    <Alert tone="warn" title="Could not check sign-in">
      <p>{sessionError}</p>
      <Button variant="secondary" onClick={() => void loadPortalSession()}>
        Check sign-in again
      </Button>
    </Alert>
  ) : null;
  if (sessionError && !isAuthed.value) return <div class="pk pk-stack">{sessionNotice}</div>;

  if (isAuthed.value) {
    const meetingDestination = meetingEntryReturnUrl(window.location.hash);
    if (meetingDestination) return <MeetingEntryReturn destination={meetingDestination} />;
    return (
      <>
        {sessionNotice}
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
      <Login
        onSignedIn={async () => {
          await loadPortalSession();
        }}
      />
    </>
  );
}
