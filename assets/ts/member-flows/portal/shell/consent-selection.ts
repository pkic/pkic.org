/*
 * The last choice for an app is remembered on this device, by the app's name:
 * an app registers a new client for every connection, so its id never repeats.
 * What is kept is what the person left unticked, so a permission the app has
 * not asked for before starts ticked, like everything on a first request.
 */
const DECLINED_KEY = "pk-mcp-consent-declined:";

/** The permissions to start from: everything offered except what was left unticked last time. */
export function rememberedSelection(clientName: string, offered: readonly string[]): Set<string> {
  let declined: unknown = [];
  try {
    declined = JSON.parse(window.localStorage.getItem(DECLINED_KEY + clientName) ?? "[]");
  } catch {
    // Without storage or with a damaged entry the consent starts from everything offered.
  }
  const skip = new Set(Array.isArray(declined) ? declined.filter((item) => typeof item === "string") : []);
  return new Set(offered.filter((permission) => !skip.has(permission)));
}

/** Remembers which of the offered permissions were left unticked. */
export function rememberSelection(clientName: string, offered: readonly string[], selected: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(
      DECLINED_KEY + clientName,
      JSON.stringify(offered.filter((permission) => !selected.has(permission))),
    );
  } catch {
    // The choice is a convenience; without storage the next request simply starts from everything.
  }
}
