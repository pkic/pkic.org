/**
 * When a screen gives control back to the device's own status page, which
 * shows the screen ID and returns to the screen page once the server
 * answers. The address and its query string are the device's contract.
 */
export const SCREEN_HANDOFF = {
  url: "http://127.0.0.1:8080/?hold=120",
  /** The page has not become ready this long after it opened. */
  notReadyMs: 90_000,
  /** Without anything good to show, the server has not answered this long. */
  unreachableMs: 3 * 60_000,
} as const;

/** The flag the page sets on the document once it shows something, which the watchdog reads. */
export const SCREEN_READY_ATTRIBUTE = "data-screen-ready";

/**
 * Hand off only when the screen has nothing good to show and the server has
 * been unreachable for long enough. A screen holding a good state never hands
 * off: it keeps showing it, marked offline.
 */
export function screenHandoffDue(input: { hasGoodState: boolean; unreachableSince: number | null; now: number }) {
  return (
    !input.hasGoodState &&
    input.unreachableSince !== null &&
    input.now - input.unreachableSince > SCREEN_HANDOFF.unreachableMs
  );
}

export function handOffScreen(location: Pick<Location, "replace"> = window.location): void {
  location.replace(SCREEN_HANDOFF.url);
}
