/**
 * Sponsor portal session persistence.
 *
 * Unlike the user portal, sponsorship access does not expose a current-user
 * resource (see _lib/auth/sponsor-portal.ts's header
 * comment: the identity is a bare `sponsorships.id`, and the session
 * cookie is HttpOnly + scoped to `/api/v1/sponsor-portal`, so JS can never
 * read it back). The only way to know *which event* to query on a repeat
 * visit is to remember what verify-link returned, so this stashes it in
 * localStorage and re-validates it against the live attendees endpoint on
 * every load (App.tsx) rather than trusting it blindly.
 */
import type { SponsorPortalSession } from "./types";
import { sponsorPortalSessionSchema } from "../../../shared/schemas/sponsor-portal";

const STORAGE_KEY = "pkic_sponsor_portal_session";

export function loadStoredSession(): SponsorPortalSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const result = sponsorPortalSessionSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function storeSession(session: SponsorPortalSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Best-effort — a private-browsing quota failure just means the next
    // reload falls back to the login screen, not a broken session.
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same best-effort note as storeSession.
  }
}
