/**
 * Member portal root — gates on member-session auth state, same shape as
 * admin/App.tsx. Session probing reuses GET /api/v1/me itself (a 401 means
 * anonymous, 200 means authenticated) since there's no dedicated member
 * "am I logged in" endpoint, matching the previous single-screen portal's
 * approach.
 */
import { useEffect, useState } from "preact/hooks";
import { getJson, postJson, ApiClientError } from "../../shared/api-client";
import { authStatus, isAuthed, setAuthChecking, saveProfile, clearAuth } from "./state";
import { Login } from "./shell/Login";
import { PortalShell } from "./shell/PortalShell";
import type { MyProfile } from "./types";

async function verifyMagicLink(token: string): Promise<void> {
  await postJson("/api/v1/auth/member/verify-link", { token });
}

function VerifyingOverlay() {
  return (
    <div class="d-flex flex-column align-items-center py-5">
      <div class="spinner-border text-success mb-3" role="status"></div>
      <p class="text-muted mb-0">Verifying your sign-in link…</p>
    </div>
  );
}

export function App() {
  const [verifying, setVerifying] = useState(() => Boolean(new URLSearchParams(window.location.search).get("token")));
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function loadProfile(): Promise<boolean> {
    try {
      const data = await getJson<MyProfile>("/api/v1/me");
      saveProfile(data);
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
      const token = new URLSearchParams(window.location.search).get("token");
      if (token) {
        try {
          await verifyMagicLink(token);
          history.replaceState({}, "", "/portal/");
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
      if (!cancelled) await loadProfile();
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
          await loadProfile();
        }}
      />
    </>
  );
}
