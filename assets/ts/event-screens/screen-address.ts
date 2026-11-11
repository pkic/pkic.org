import { screenIdSchema, type ScreenId } from "../../shared/schemas/event-screens";

/**
 * Reads the screen ID from a screen page's address, which rides the fragment
 * so the page stays static: `/live/screen/#id=K7M2QA`. Null when it is
 * missing or malformed.
 */
export function parseScreenPageAddress(location: { hash: string }): { screenId: ScreenId } | null {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const parsed = screenIdSchema.safeParse(fragment.get("id"));
  return parsed.success ? { screenId: parsed.data } : null;
}
