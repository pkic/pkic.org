import { useEffect } from "preact/hooks";
import { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import { rememberedIdentityKey } from "./acting-identity";
import { ApiClientError, getJson } from "../../shared/api-client";
import { onSessionPresence } from "../../shared/session-presence";
import { clearMemberProfile, expirePortalSession, portalSession, savePortalSession } from "./state";

/** Bound refresh traffic while leaving ample margin before the one-hour staff inactivity limit. */
export const SESSION_ACTIVITY_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Acknowledges real browser interaction through the canonical live-session
 * check, and for anyone with a role also a live room the page follows. The
 * response rotates the signed cookie and records the first authenticated
 * activity of the UTC calendar month in the standing ledger. Only a role's
 * elevation sits idle within the hour a talk runs; everyone else's session
 * lasts days untouched, so a room they follow asks for nothing.
 */
export function useSessionActivity(): void {
  const session = portalSession.value;
  const sessionId = session?.sessionId;
  const userId = session?.identity.id;
  useEffect(() => {
    if (!sessionId || !userId) return;
    const activeUserId = userId;

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

    function identityChangedInAnotherTab(event: StorageEvent): void {
      if (
        event.key === rememberedIdentityKey(activeUserId) ||
        event.key === `portal-identity-changed:${activeUserId}`
      ) {
        // Scoped screens must discard data loaded for the previous identity.
        window.location.reload();
      }
    }

    const stopPresence = onSessionPresence(() => {
      if (portalSession.value?.staff) acknowledgeInteraction();
    });
    window.addEventListener("storage", identityChangedInAnotherTab);
    window.addEventListener("focus", acknowledgeInteraction);
    window.addEventListener("pageshow", acknowledgeInteraction);
    window.addEventListener("scroll", acknowledgeInteraction, { passive: true });
    document.addEventListener("pointerdown", acknowledgeInteraction, { passive: true });
    document.addEventListener("keydown", acknowledgeInteraction);
    document.addEventListener("visibilitychange", acknowledgeVisiblePage);
    return () => {
      clearTimeout(refreshTimer);
      stopPresence();
      window.removeEventListener("storage", identityChangedInAnotherTab);
      window.removeEventListener("focus", acknowledgeInteraction);
      window.removeEventListener("pageshow", acknowledgeInteraction);
      window.removeEventListener("scroll", acknowledgeInteraction);
      document.removeEventListener("pointerdown", acknowledgeInteraction);
      document.removeEventListener("keydown", acknowledgeInteraction);
      document.removeEventListener("visibilitychange", acknowledgeVisiblePage);
    };
  }, [sessionId, userId, session?.idleExpiresAt, session?.staff?.idleExpiresAt]);
}
