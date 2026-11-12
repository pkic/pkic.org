import { screenIdSchema, type ScreenId } from "../../shared/schemas/event-screens";

/** Where the screen page runs: on a venue screen device, or in any other browser set up as a screen. */
export type ScreenPageHost = "device" | "browser";

/**
 * Reads a screen page's address, which rides the fragment so the page stays
 * static. A screen device opens `#id=K7M2QA&agent=1`; a browser set up as a
 * screen carries `#id=K7M2QA&browser=1`, which its setup writes. Only a
 * device reaches its local service or hands back to its status page.
 *
 * Without a marker, an address with an ID is a device's from before devices
 * marked themselves, and runs as a device. This rule can go once every
 * device's agent sends `agent=1`; an address with neither marker nor ID is a
 * browser about to be set up. The ID is null when missing or malformed.
 */
export function parseScreenPageAddress(location: { hash: string }): {
  screenId: ScreenId | null;
  host: ScreenPageHost;
} {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const parsed = screenIdSchema.safeParse(fragment.get("id"));
  const screenId = parsed.success ? parsed.data : null;
  const host: ScreenPageHost =
    fragment.get("agent") === "1"
      ? "device"
      : fragment.get("browser") === "1"
        ? "browser"
        : screenId
          ? "device"
          : "browser";
  return { screenId, host };
}

/** The address a browser screen continues on once it has its ID. */
export function browserScreenAddress(screenId: ScreenId): string {
  return new URLSearchParams({ id: screenId, browser: "1" }).toString();
}
