/**
 * Portal SPA global signals. Authentication belongs to one identity with
 * independently optional staff/member/sponsor capacities; member profile state is
 * loaded only when the backend returns member capacity.
 */
import { signal, computed } from "@preact/signals";
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
