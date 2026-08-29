/**
 * Portal root — gates on identity authentication, then loads member profile
 * data only when the session advertises member capacity. Staff-only users can
 * therefore enter the portal without being granted member-only API access.
 */
import { useEffect, useState } from "preact/hooks";
import { getJson, postJson, ApiClientError } from "../../shared/api-client";
import {
  authStatus,
  isAuthed,
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

async function verifyMagicLink(token: string): Promise<void> {
  const session = await postJson("/api/v1/auth/verify-link", { token }, userAuthEstablishedResponseSchema);
  savePortalSession(session);
}

export function portalMagicLinkToken(hash: string): string | null {
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get("token");
}

export function App() {
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
      return true;
    } catch {
      clearAuth();
      return false;
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function run(): Promise<void> {
      setAuthChecking();
      const token = portalMagicLinkToken(window.location.hash);
      if (token) {
        history.replaceState({}, "", "/portal/");
        try {
          await verifyMagicLink(token);
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
  }, []);

  if (verifying || authStatus.value === "loading") {
    return <VerifyingOverlay />;
  }

  if (isAuthed.value) {
    return <PortalShell />;
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
