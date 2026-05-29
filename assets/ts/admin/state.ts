/**
 * Admin SPA global signals.
 *
 * Signals are reactive — any component that reads a signal will automatically
 * re-render when that signal's value changes.
 */
import { signal, computed } from "@preact/signals";
import type { EventSummary, EventDetail } from "./types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export const authStatus = signal<AuthStatus>("loading");
export const authEmail = signal<string | null>(null);
export const isAuthed = computed(() => authStatus.value === "authenticated");

export const eventList = signal<EventSummary[]>([]);
export const currentEvent = signal<EventDetail | null>(null);

export function setAuthChecking(): void {
  authStatus.value = "loading";
}

export function saveAuth(email: string | null): void {
  authStatus.value = "authenticated";
  authEmail.value = email;
}

export function clearAuth(): void {
  authStatus.value = "anonymous";
  authEmail.value = null;
}
