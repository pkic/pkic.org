/**
 * The room's screens for the studio's Screens panel: the room's screen list,
 * read when the panel opens and every few minutes after, and the event's
 * screen monitor for their live state, limited to this room.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { eventScreensListSchema, type ScreenRecord } from "../../../../../../../../shared/schemas/event-screens";
import { getJson } from "../../../../../../../shared/api-client";
import { eventScreensPath } from "../../screens/screen-requests";
import { useScreenMonitorController } from "../../screens/useScreenMonitorController";

const RELOAD_MS = 5 * 60_000;

export function useStudioScreens({ slug, roomId, enabled }: { slug: string; roomId: string; enabled: boolean }) {
  const [screens, setScreens] = useState<readonly ScreenRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled || !roomId) return;
    const abort = new AbortController();
    const load = () =>
      getJson(
        `${eventScreensPath(slug)}?${new URLSearchParams({ roomId, sort: "name", limit: "100" })}`,
        eventScreensListSchema,
        { signal: abort.signal },
      ).then(
        (response) => {
          setScreens(response.screens);
          setLoaded(true);
        },
        () => undefined,
      );
    void load();
    const timer = setInterval(() => void load(), RELOAD_MS);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [slug, roomId, enabled]);
  const only = useMemo(() => new Set(screens.map((screen) => screen.id)), [screens]);
  const controller = useScreenMonitorController({ slug, enabled: enabled && Boolean(roomId), only, ready: loaded });
  const { remember } = controller;
  useEffect(() => remember(screens), [screens, remember]);
  return { screens, controller };
}
