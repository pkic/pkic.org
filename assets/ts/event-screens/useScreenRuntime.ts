import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { SCREEN_POLICY } from "../../shared/event-screen-policy";
import type { ScreenId, ScreenOwnView, ScreenPairingResponse } from "../../shared/schemas/event-screens";
import { ApiClientError } from "../shared/api-client";
import { screenApi, screenApiUnreachable, screenMustPair, type ScreenApi } from "./screen-api";
import {
  mergeScreenAgenda,
  readScreenCache,
  screenAgendaRevision,
  screenCacheKey,
  type ScreenCache,
  type ScreenCachedAgenda,
} from "./screen-cache";
import { screenClockSample, type ScreenClock } from "./screen-clock";
import type { ScreenLink } from "./screen-display";

/** Ask for a fresh code this long before the current one expires, so staff never type a dead one. */
const PAIRING_RENEW_BEFORE_MS = 30_000;
/** Wait this long before asking again after the server could not be reached while pairing. */
const PAIRING_RETRY_MS = 5_000;

/**
 * The screen's own conversation with the API: its read every minute, which
 * brings its assignment, fresh overlay access, the server's clock and its
 * agenda; and, while it must pair, its pairing code and the poll for staff's
 * approval. It starts from the device's copy so the screen shows its last
 * good state at once.
 */
export function useScreenRuntime({
  screenId,
  storage,
  clock,
  api = screenApi,
}: {
  screenId: ScreenId;
  storage: Storage;
  clock: ScreenClock;
  api?: ScreenApi;
}) {
  const [cached] = useState<ScreenCache | null>(() => readScreenCache(storage, screenId));
  const [view, setView] = useState<ScreenOwnView | ScreenCache["view"] | null>(cached?.view ?? null);
  const [agenda, setAgenda] = useState<ScreenCachedAgenda | null>(cached?.agenda ?? null);
  const [overlayToken, setOverlayToken] = useState<string | null>(null);
  const [pairingRequired, setPairingRequired] = useState(false);
  const [pairing, setPairing] = useState<ScreenPairingResponse | null>(null);
  const [read, setRead] = useState<ScreenLink>({
    connected: false,
    lastUpdateAt: cached ? Date.parse(cached.savedAt) : null,
  });
  const [unreachableSince, setUnreachableSince] = useState<number | null>(null);
  const agendaRef = useRef(agenda);
  agendaRef.current = agenda;

  const reached = useCallback(() => setUnreachableSince(null), []);
  const missed = useCallback(
    (error: unknown) => {
      if (screenApiUnreachable(error)) setUnreachableSince((since) => since ?? clock.now());
    },
    [clock],
  );

  const refresh = useCallback(async () => {
    try {
      const { response, sentAt, receivedAt } = await api.read(
        screenId,
        screenAgendaRevision(agendaRef.current, clock.now()),
      );
      reached();
      if (response.viewer !== "screen")
        throw new ApiClientError({ error: { code: "SCREEN_SESSION_MISSING", message: "" } }, 401);
      clock.record(screenClockSample(sentAt, receivedAt, response.serverNow));
      const nextAgenda = mergeScreenAgenda(agendaRef.current, response.agenda);
      agendaRef.current = nextAgenda;
      setView(response);
      setAgenda(nextAgenda);
      setOverlayToken(response.overlay?.token ?? null);
      setPairingRequired(false);
      setRead({ connected: true, lastUpdateAt: clock.now() });
    } catch (error) {
      if (screenMustPair(error)) {
        // A screen that must pair again forgets what it showed: it may now belong to another event.
        try {
          storage.removeItem(screenCacheKey(screenId));
        } catch {
          /* Nothing kept to forget. */
        }
        agendaRef.current = null;
        setView(null);
        setAgenda(null);
        setOverlayToken(null);
        setPairingRequired(true);
        reached();
        return;
      }
      missed(error);
      setRead((link) => ({ ...link, connected: false }));
    }
  }, [api, clock, missed, reached, screenId, storage]);

  useEffect(() => {
    void refresh();
    const every = setInterval(() => void refresh(), SCREEN_POLICY.readSeconds * 1000);
    return () => clearInterval(every);
  }, [refresh]);

  useEffect(() => {
    if (!pairingRequired) return;
    let stopped = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let current: ScreenPairingResponse | null = null;
    const later = (step: () => Promise<void>, ms: number) => {
      if (!stopped) next = setTimeout(() => void step(), ms);
    };
    async function requestCode() {
      try {
        current = await api.startPairing(screenId);
        if (stopped) return;
        reached();
        setPairing(current);
        later(poll, SCREEN_POLICY.pairingPollSeconds * 1000);
      } catch (error) {
        missed(error);
        later(requestCode, PAIRING_RETRY_MS);
      }
    }
    async function poll() {
      if (!current || Date.parse(current.expiresAt) - clock.now() < PAIRING_RENEW_BEFORE_MS) return requestCode();
      try {
        const result = await api.pollSession(screenId);
        if (stopped) return;
        reached();
        if (result.status === "active") {
          setPairing(null);
          await refresh();
          return;
        }
      } catch (error) {
        // The code expired or was used: show a new one.
        if (error instanceof ApiClientError && (error.status === 410 || error.status === 401)) return requestCode();
        missed(error);
      }
      later(poll, SCREEN_POLICY.pairingPollSeconds * 1000);
    }
    void requestCode();
    return () => {
      stopped = true;
      clearTimeout(next);
    };
  }, [api, clock, missed, pairingRequired, reached, refresh, screenId]);

  return { cached, view, agenda, overlayToken, pairingRequired, pairing, read, unreachableSince, refresh };
}
