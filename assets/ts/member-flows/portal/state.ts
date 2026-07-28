/**
 * Portal SPA global signals — mirrors admin/state.ts's shape, scoped to the
 * member session instead of the admin session.
 */
import { signal, computed } from "@preact/signals";
import type { MyProfile } from "./types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export const authStatus = signal<AuthStatus>("loading");
export const profile = signal<MyProfile | null>(null);
export const isAuthed = computed(() => authStatus.value === "authenticated");

export function setAuthChecking(): void {
  authStatus.value = "loading";
}

export function saveProfile(next: MyProfile): void {
  authStatus.value = "authenticated";
  profile.value = next;
}

export function clearAuth(): void {
  authStatus.value = "anonymous";
  profile.value = null;
}
