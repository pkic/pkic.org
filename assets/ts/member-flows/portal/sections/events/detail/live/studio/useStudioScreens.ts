/**
 * The room's screens for the studio's Screens panel: the room's screen list,
 * every page of it, read when the panel opens and every few minutes after,
 * and the event's screen monitor for their live state, limited to this room.
 * What it holds belongs to one event and room; another room starts empty.
 */
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { MAX_PAGE_OFFSET } from "../../../../../../../../shared/schemas/pagination";
import { eventScreensListSchema, type ScreenRecord } from "../../../../../../../../shared/schemas/event-screens";
import { getJson } from "../../../../../../../shared/api-client";
import { eventScreensPath } from "../../screens/screen-requests";
import { useScreenMonitorController } from "../../screens/useScreenMonitorController";

const RELOAD_MS = 5 * 60_000;
const PAGE_SIZE = 100;

export type StudioScreensLoad = "loading" | "ready" | "error";

/** Every page of the room's screens, within the list's offset limit. */
export async function loadRoomScreens(slug: string, roomId: string, signal: AbortSignal): Promise<ScreenRecord[]> {
  const screens: ScreenRecord[] = [];
  for (let offset = 0; offset <= MAX_PAGE_OFFSET; offset += PAGE_SIZE) {
    const query = new URLSearchParams({ roomId, sort: "name", limit: String(PAGE_SIZE), offset: String(offset) });
    const page = await getJson(`${eventScreensPath(slug)}?${query}`, eventScreensListSchema, { signal });
    screens.push(...page.screens);
    if (!page.page.hasMore) return screens;
  }
  // More than the list can page through: say the read failed rather than show part of the room.
  throw new Error("The room has more screens than the panel can list.");
}

export function useStudioScreens({ slug, roomId, enabled }: { slug: string; roomId: string; enabled: boolean }) {
  const scope = `${slug}\n${roomId}`;
  const [state, setState] = useState<{ scope: string; screens: readonly ScreenRecord[]; load: StudioScreensLoad }>({
    scope,
    screens: [],
    load: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    if (!enabled || !roomId) return;
    const abort = new AbortController();
    // Another event or room never shows what this one held, even while its first read is out.
    setState((current) =>
      current.scope === scope
        ? { ...current, load: current.load === "ready" ? "ready" : "loading" }
        : { scope, screens: [], load: "loading" },
    );
    const load = () =>
      loadRoomScreens(slug, roomId, abort.signal).then(
        (screens) => setState({ scope, screens, load: "ready" }),
        () => {
          if (!abort.signal.aborted) setState((current) => ({ ...current, scope, load: "error" }));
        },
      );
    void load();
    const timer = setInterval(() => void load(), RELOAD_MS);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [slug, roomId, enabled, scope, attempt]);

  const current =
    state.scope === scope ? state : { scope, screens: [] as readonly ScreenRecord[], load: "loading" as const };
  const only = useMemo(() => new Set(current.screens.map((screen) => screen.id)), [current.screens]);
  const controller = useScreenMonitorController({
    slug,
    enabled: enabled && Boolean(roomId),
    only,
    ready: current.load === "ready",
  });
  const { remember } = controller;
  useEffect(() => remember(current.screens), [current.screens, remember]);
  return { screens: current.screens, load: current.load, retry, controller };
}
