import { screenIdSchema, type ScreenId } from "../../shared/schemas/event-screens";

/**
 * Reads a screen page's address, which rides the fragment so the page stays
 * static. A venue screen device opens `/live/screen/#id=K7M2QA&agent=1`; the
 * marker is the device's own, and only with it does the page reach the
 * device's local service. Any other browser is a browser screen and never
 * touches the local address. The ID is null when it is missing or malformed.
 */
export function parseScreenPageAddress(location: { hash: string }): { screenId: ScreenId | null; agent: boolean } {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const parsed = screenIdSchema.safeParse(fragment.get("id"));
  return { screenId: parsed.success ? parsed.data : null, agent: fragment.get("agent") === "1" };
}
