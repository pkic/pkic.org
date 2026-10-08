import { useEffect } from "preact/hooks";
import { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import { ApiClientError, getJson } from "../../shared/api-client";
import { clearMemberProfile, expirePortalSession, portalSession, savePortalSession } from "./state";

/** Bound refresh traffic while leaving ample margin before the one-hour staff inactivity limit. */
export const SESSION_ACTIVITY_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Acknowledges real browser interaction through the canonical live-session
 * check. The response rotates only the signed cookie; it does not update D1.
 */
export function useSessionActivity(): void {
  const session = portalSession.value;
  useEffect(() => {
    if (!session) return;
    const sessionId = session.sessionId;

    let lastRefreshAt = Date.now();
    let refreshPending = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    async function refresh(): Promise<void> {
      if (refreshPending || portalSession.value?.sessionId !== sessionId) return;
      refreshPending = true;
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
      lastRefreshAt = Date.now();
      try {
        const next = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
        if (portalSession.value?.sessionId !== sessionId || next.sessionId !== sessionId) return;
        savePortalSession(next);
        if (!next.member) clearMemberProfile();
      } catch (error) {
        if (
          portalSession.value?.sessionId === sessionId &&
          error instanceof ApiClientError &&
          [401, 403].includes(error.status)
        )
          expirePortalSession();
        // A transient failure leaves the last server-confirmed deadline in
        // place. The expiry hook will fail closed if no later refresh succeeds.
      } finally {
        refreshPending = false;
      }
    }

    function acknowledgeInteraction(): void {
      const remaining = SESSION_ACTIVITY_REFRESH_INTERVAL_MS - (Date.now() - lastRefreshAt);
      if (remaining <= 0) {
        void refresh();
        return;
      }
      // Preserve an interaction near the start of the throttle window instead
      // of letting the server forget it. Multiple events share one trailing call.
      if (refreshTimer === undefined) refreshTimer = setTimeout(() => void refresh(), remaining);
    }

    function acknowledgeVisiblePage(): void {
      if (document.visibilityState === "visible") acknowledgeInteraction();
    }

    window.addEventListener("focus", acknowledgeInteraction);
    window.addEventListener("pageshow", acknowledgeInteraction);
    window.addEventListener("scroll", acknowledgeInteraction, { passive: true });
    document.addEventListener("pointerdown", acknowledgeInteraction, { passive: true });
    document.addEventListener("keydown", acknowledgeInteraction);
    document.addEventListener("visibilitychange", acknowledgeVisiblePage);
    return () => {
      clearTimeout(refreshTimer);
      window.removeEventListener("focus", acknowledgeInteraction);
      window.removeEventListener("pageshow", acknowledgeInteraction);
      window.removeEventListener("scroll", acknowledgeInteraction);
      document.removeEventListener("pointerdown", acknowledgeInteraction);
      document.removeEventListener("keydown", acknowledgeInteraction);
      document.removeEventListener("visibilitychange", acknowledgeVisiblePage);
    };
  }, [session?.sessionId, session?.idleExpiresAt, session?.staff?.idleExpiresAt]);
}
