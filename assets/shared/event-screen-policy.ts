/**
 * How long each part of pairing and running a screen lasts. The screen page,
 * the API and the tests read these values from here.
 */
export const SCREEN_POLICY = {
  /** A pairing code, and the challenge that proves which screen shows it, lasts this long. */
  pairingMinutes: 10,
  /** How often the pairing page asks whether staff approved its code. */
  pairingPollSeconds: 3,
  /** A paired screen stays signed in this long since its last renewal (400 days, the most browsers keep a cookie). */
  sessionDays: 400,
  /** A screen's sign-in is renewed when it is at least this old. */
  sessionRenewalHours: 24,
  /** How often a screen's visit updates its last-seen time. */
  lastSeenMinutes: 5,
  /** The overlay access a screen receives for its room lasts this long; the screen asks again before then. */
  overlayAccessMinutes: 15,
} as const;

export const SCREEN_SESSION_MAX_AGE_SECONDS = SCREEN_POLICY.sessionDays * 24 * 60 * 60;
