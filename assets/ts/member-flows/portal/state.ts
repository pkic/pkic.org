/**
 * Portal SPA global signals. Authentication belongs to one identity with
 * independently optional staff/member/sponsor capacities; member profile state is
 * loaded only when the backend returns member capacity.
 */
import { signal, computed } from "@preact/signals";
import { setErrorPayloadInterceptor, setUnauthorizedHandler } from "../../shared/api-client";
import type { ApiErrorPayload } from "../../../shared/schemas/api-common";
import { PERMISSION_DENIED_WITH_REFRESH_MESSAGE } from "../../../shared/auth-errors";
import type { MyProfile, PortalSession } from "./types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export const authStatus = signal<AuthStatus>("loading");
export const portalSession = signal<PortalSession | null>(null);
export const profile = signal<MyProfile | null>(null);
export const isAuthed = computed(() => authStatus.value === "authenticated" && Boolean(portalSession.value));

export function setAuthChecking(): void {
  authStatus.value = "loading";
}

export function saveProfile(next: MyProfile): void {
  profile.value = next;
}

export function clearMemberProfile(): void {
  profile.value = null;
}

export function savePortalSession(next: PortalSession): void {
  portalSession.value = next;
  authStatus.value = "authenticated";
  restoreReturnPath();
}

export function clearUserSession(): void {
  portalSession.value = null;
  profile.value = null;
}

export function finishAuthCheck(): void {
  authStatus.value = portalSession.value ? "authenticated" : "anonymous";
}

export function clearAuth(): void {
  authStatus.value = "anonymous";
  portalSession.value = null;
  profile.value = null;
}

/**
 * sessionStorage key for the hash location a forced sign-out interrupted, so
 * a subsequent re-authentication in the same tab can return the user there.
 */
const RETURN_PATH_KEY = "pkic_portal_return_path";

function readSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null; // sessionStorage may be restricted in some private-browsing environments
  }
}

function writeSessionStorage(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore — sessionStorage unavailable
  }
}

function clearSessionStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore — sessionStorage unavailable
  }
}

/** Records the current hash location so it survives a forced sign-out. */
function recordReturnPath(): void {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (hash && hash !== "#/" && hash !== "#") {
    writeSessionStorage(RETURN_PATH_KEY, hash);
  }
}

/** Restores and clears a saved return path once a session is (re-)established. */
function restoreReturnPath(): void {
  const hash = readSessionStorage(RETURN_PATH_KEY);
  if (!hash) return;
  clearSessionStorage(RETURN_PATH_KEY);
  if (typeof window !== "undefined" && window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

/**
 * Handles a 401 from the shared API client: records where the user was, then
 * clears auth so the SPA falls back to the Login screen instead of rendering
 * the raw server error message. Safe to call more than once in a row — e.g.
 * several requests in flight when the session expires can each report a 401
 * — since recording the path is a plain sessionStorage write and clearAuth
 * only resets signals to values they may already hold.
 */
function handleUnauthorizedResponse(): void {
  recordReturnPath();
  clearAuth();
}

/** Rewrites SCOPE_REQUIRED errors so the portal never surfaces internal scope names. */
function mapPortalErrorPayload(payload: ApiErrorPayload): ApiErrorPayload {
  if (payload.error.code !== "SCOPE_REQUIRED") return payload;
  return { error: { ...payload.error, message: PERMISSION_DENIED_WITH_REFRESH_MESSAGE } };
}

/**
 * Wires the shared API client's global 401 and error-message hooks to portal
 * behavior. Call exactly once at portal bootstrap (see portal-page.tsx) so
 * every portal request — whichever helper it uses — gets consistent 401 and
 * SCOPE_REQUIRED handling without each call site opting in.
 */
export function installPortalApiInterceptors(): void {
  setUnauthorizedHandler(handleUnauthorizedResponse);
  setErrorPayloadInterceptor(mapPortalErrorPayload);
}
