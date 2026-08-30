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
} from "./state";
import { Login } from "./shell/Login";
import { PortalShell } from "./shell/PortalShell";
import { VerifyingOverlay } from "../../components/VerifyingOverlay";
import { myProfileSchema } from "../../../shared/schemas/me";
import { userAuthEstablishedResponseSchema, userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import { SponsorAccess } from "./sections/sponsors/Access";
import { portalDefaultPath } from "./shell/portal-navigation";
import type { PortalSession } from "./types";
import { McpAuthorization } from "./shell/McpAuthorization";

async function verifyMagicLink(token: string): Promise<PortalSession> {
  const session = await postJson("/api/v1/auth/verify-link", { token }, userAuthEstablishedResponseSchema);
  savePortalSession(session);
  return session;
}

function portalHashPath(hash: string): string {
  return (hash.replace(/^#/, "").split("?", 1)[0] || "/").replace(/\/$/, "") || "/";
}

export function portalMagicLinkToken(hash: string): string | null {
  if (portalHashPath(hash) !== "/verify") return null;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get("token");
}

export function App() {
  const isMcpAuthorization = portalHashPath(window.location.hash) === "/auth/oauth";
  const [verifying, setVerifying] = useState(() => Boolean(portalMagicLinkToken(window.location.hash)));
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function loadPortalSession(): Promise<boolean> {
    try {
      const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
      savePortalSession(session);
      if (session.member) {
        saveProfile(await getJson("/api/v1/users/current", myProfileSchema));
      } else {
        clearMemberProfile();
      }
    } catch {
      clearUserSession();
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
          // Session establishment may have restored a recorded return path;
          // only replace the hash when it still carries the verify token.
          if (portalHashPath(window.location.hash) === "/verify") {
            history.replaceState({}, "", `/portal/#${portalDefaultPath(session)}`);
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

  if (isAuthed.value) {
    return <PortalShell />;
  }

  if (portalHashPath(window.location.hash).startsWith("/sponsors")) {
    return (
      <>
        {verifyError && (
          <div class="container content-width-sm">
            <div class="alert alert-danger mt-4">✕ Sponsor access failed: {verifyError}</div>
          </div>
        )}
        <SponsorAccess />
      </>
    );
  }

  return (
    <>
      {verifyError && (
        <div class="container content-width-sm">
          <div class="alert alert-danger mt-4">✕ Sign-in failed: {verifyError}</div>
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
