/**
 * Sponsor portal root — mounted at /sponsor-portal/.
 * Much smaller than the member/admin portals: no nav shell, just a
 * token-verification gate in front of a single Attendees screen (see
 * state.ts's header comment for why session state has to be persisted
 * client-side rather than probed from a "who am I" endpoint).
 */
import { useEffect, useState } from "preact/hooks";
import { postJson, ApiClientError } from "../../shared/api-client";
import { loadStoredSession, storeSession, clearStoredSession } from "./state";
import { Login } from "./Login";
import { Attendees } from "./Attendees";
import type { SponsorPortalSession } from "./types";
import { sponsorPortalAuthVerifyResponseSchema } from "../../../shared/schemas/sponsor-portal";
import { VerifyingOverlay } from "../../components/VerifyingOverlay";

async function verifyMagicLink(token: string): Promise<SponsorPortalSession> {
  const res = sponsorPortalAuthVerifyResponseSchema.parse(
    await postJson<unknown>("/api/v1/auth/sponsor-portal/verify-link", { token }),
  );
  return res.sponsorship;
}

export function App() {
  const [session, setSession] = useState<SponsorPortalSession | null>(() => loadStoredSession());
  const [verifying, setVerifying] = useState(() => Boolean(new URLSearchParams(window.location.search).get("token")));
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;

    let cancelled = false;
    async function run(): Promise<void> {
      try {
        const sponsorship = await verifyMagicLink(token as string);
        if (cancelled) return;
        storeSession(sponsorship);
        setSession(sponsorship);
        history.replaceState({}, "", "/sponsor-portal/");
      } catch (err) {
        if (cancelled) return;
        setVerifyError(err instanceof ApiClientError ? err.message : "The link may have expired or already been used.");
        clearStoredSession();
        setSession(null);
      } finally {
        if (!cancelled) setVerifying(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleUnauthorized(): void {
    clearStoredSession();
    setSession(null);
  }

  async function handleSignOut(): Promise<void> {
    try {
      await postJson("/api/v1/sponsor-portal/logout", {});
    } finally {
      clearStoredSession();
      setSession(null);
    }
  }

  if (verifying) {
    return <VerifyingOverlay />;
  }

  if (session) {
    return (
      <>
        <div class="d-flex justify-content-end container py-2 content-width-xl">
          <button
            class="btn btn-sm btn-outline-secondary"
            onClick={() => {
              void handleSignOut();
            }}
          >
            Sign out
          </button>
        </div>
        <Attendees session={session} onUnauthorized={handleUnauthorized} />
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
      <Login />
    </>
  );
}
