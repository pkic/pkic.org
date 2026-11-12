/**
 * A browser screen's own screen ID: six base32 characters from the
 * browser's secure random source, kept in this browser so it stays the same
 * screen across reloads and visits. A device prints its own ID instead.
 */
import { screenIdSchema, type ScreenId } from "../../shared/schemas/event-screens";

export const BROWSER_SCREEN_ID_KEY = "pkic.screen.browserId";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A fresh ID; 32 divides 256, so taking each byte modulo 32 favors no character. */
export function generateBrowserScreenId(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): ScreenId {
  const bytes = random(new Uint8Array(6));
  return screenIdSchema.parse(Array.from(bytes, (byte) => BASE32[byte % 32]).join(""));
}

/** This browser's screen ID, made and kept on first use; a stored value that is not an ID is replaced. */
export function browserScreenId(storage: Pick<Storage, "getItem" | "setItem">, generate = generateBrowserScreenId) {
  let stored: string | null = null;
  try {
    stored = storage.getItem(BROWSER_SCREEN_ID_KEY);
  } catch {
    /* Storage refused: a new ID for this visit. */
  }
  const parsed = screenIdSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  const id = generate();
  try {
    storage.setItem(BROWSER_SCREEN_ID_KEY, id);
  } catch {
    /* Kept for this visit only. */
  }
  return id;
}
