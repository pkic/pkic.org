import { SOURCE_TYPES } from "../../shared/constants/source-types";

export interface QueryContext {
  eventSlug: string | null;
  inviteToken: string | null;
  referralCode: string | null;
  sourceType: string | null;
  token: string | null;
}

/** sessionStorage key used to persist referral attribution within a tab session. */
const REFERRAL_SESSION_KEY = "pkic_ref";

/** Valid referral code format — must match the backend regex. */
const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9]{6,12}$/;

/** Valid source types — must match the backend sourceTypeSchema enum. */
const VALID_SOURCE_TYPES = new Set<string>(SOURCE_TYPES);

function readSourceType(query: URLSearchParams): string | null {
  const value = read(query, "source");
  return value && VALID_SOURCE_TYPES.has(value) ? value : null;
}

function read(query: URLSearchParams, key: string): string | null {
  const value = query.get(key);
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Clears the referral code from sessionStorage. Call this after a successful
 * registration or proposal submission so attribution is not re-used for a
 * future, unrelated action in the same tab.
 */
export function clearReferralSession(): void {
  try {
    sessionStorage.removeItem(REFERRAL_SESSION_KEY);
  } catch {
    // sessionStorage may be restricted in some private-browsing environments
  }
}

export function parseQueryContext(search: string): QueryContext {
  const query = new URLSearchParams(search);

  // Try URL first, then fall back to sessionStorage so attribution survives
  // navigation within the same tab (e.g. user browses the agenda before registering).
  let referralCode = read(query, "ref");

  if (referralCode) {
    // Persist for the remainder of this tab session
    try {
      sessionStorage.setItem(REFERRAL_SESSION_KEY, referralCode);
    } catch {
      // ignore — sessionStorage unavailable
    }
  } else {
    // Fall back to stored value if it looks like a valid code
    try {
      const stored = sessionStorage.getItem(REFERRAL_SESSION_KEY);
      if (stored && REFERRAL_CODE_PATTERN.test(stored)) {
        referralCode = stored;
      }
    } catch {
      // ignore — sessionStorage unavailable
    }
  }

  return {
    eventSlug: read(query, "event"),
    inviteToken: read(query, "invite"),
    referralCode,
    sourceType: readSourceType(query),
    token: read(query, "token"),
  };
}
