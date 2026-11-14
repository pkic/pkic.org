import { SOURCE_TYPES } from "../../shared/constants/source-types";

export interface QueryContext {
  eventSlug: string | null;
  id: string | null;
  inviteToken: string | null;
  inviteId: string | null;
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

/**
 * An invitation token never rides in a sign-in link's return path: that link
 * is stored in the email outbox, and D1 holds no usable capability token. The
 * page keeps the token in this browser under the invitation id instead, so a
 * person who signs in from the emailed link lands back on their invitation.
 */
const INVITATION_STORAGE_PREFIX = "pkic_invite:";

function rememberInvitation(inviteId: string | null, inviteToken: string | null): string | null {
  if (!inviteId) return inviteToken;
  try {
    if (inviteToken) localStorage.setItem(`${INVITATION_STORAGE_PREFIX}${inviteId}`, inviteToken);
    else return localStorage.getItem(`${INVITATION_STORAGE_PREFIX}${inviteId}`);
  } catch {
    // localStorage may be restricted; the token then stays in this page only.
  }
  return inviteToken;
}

/**
 * A path, with its query, as a sign-in return path: the invitation token is
 * kept in this browser under its invitation id and left out of the path.
 */
export function signInReturnPath(path: string): string {
  const [pathname = "", search = ""] = path.split(/\?(.*)/s, 2);
  const query = new URLSearchParams(search);
  rememberInvitation(read(query, "id"), read(query, "invite"));
  query.delete("invite");
  const rest = query.toString();
  return `${pathname}${rest ? `?${rest}` : ""}`;
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
    id: read(query, "id"),
    inviteToken: rememberInvitation(read(query, "id"), read(query, "invite")),
    inviteId: read(query, "id"),
    referralCode,
    sourceType: readSourceType(query),
    token: read(query, "token"),
  };
}
