/**
 * Admin SPA global signals.
 *
 * Signals are reactive — any component that reads a signal will automatically
 * re-render when that signal's value changes.
 */
import { signal, computed } from "@preact/signals";
import type { EventSummary, EventDetail } from "./types";

export const authToken = signal<string | null>(localStorage.getItem("pkic_at"));
export const authEmail = signal<string | null>(localStorage.getItem("pkic_ae"));
export const isAuthed = computed(() => Boolean(authToken.value));

export const eventList = signal<EventSummary[]>([]);
export const currentEvent = signal<EventDetail | null>(null);

export function saveAuthToken(token: string): void {
  authToken.value = token;
  localStorage.setItem("pkic_at", token);
}

export function saveAuth(token: string, email: string | null): void {
  saveAuthToken(token);
  authEmail.value = email;
  if (email) localStorage.setItem("pkic_ae", email);
}

export function clearAuth(): void {
  authToken.value = null;
  authEmail.value = null;
  localStorage.removeItem("pkic_at");
  localStorage.removeItem("pkic_ae");
}
