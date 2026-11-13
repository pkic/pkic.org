import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ScreenManagerCommand } from "../../shared/schemas/event-screen-monitor";
import type { ScreenId } from "../../shared/schemas/event-screens";
import { formatLiveDuration } from "../../shared/live-timer-format";
import { LiveOverlayPresentation } from "../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../live-session/live-room-state";
import { useLiveTimerNow } from "../live-session/useLiveCountdown";
import type { ScreenApi } from "./screen-api";
import { cachedLiveSnapshot, cachedScreenView, liveStateFromCache, writeScreenCache } from "./screen-cache";
import type { ScreenClock } from "./screen-clock";
import { screenDisplay, type ScreenDisplay, type ScreenLink } from "./screen-display";
import { screenHandoffDue, SCREEN_READY_ATTRIBUTE } from "./screen-handoff";
import { ScreenLiveFeed, type ScreenLiveReport } from "./ScreenLiveFeed";
import { ScreenIdentify } from "./ScreenIdentify";
import { ScreenLivestreamPlayer } from "./ScreenLivestreamPlayer";
import { browserScreenSound, type BrowserScreen } from "./browser-screen";
import { BrowserScreenResume } from "./BrowserScreenResume";
import { useBrowserScreenState } from "./useBrowserScreenState";
import { livestreamPlayerReport, subscribeLivestreamPlayerReport } from "./livestream-player-report";
import { screenHealth, screenPageVersion } from "./screen-health";
import { useScreenMonitor } from "./useScreenMonitor";
import { ScreenMarker } from "./ScreenMarker";
import { ScreenPairing, ScreenWaiting } from "./ScreenStatus";
import { useScreenRuntime } from "./useScreenRuntime";

/** The live picture is copied to the device at most this often; the read's copy is written at once. */
const LIVE_CACHE_EVERY_MS = 5_000;

type HeldLive = ScreenLink & { state: LiveRoomState | null };

/** The display, drawn: status pages, or the room's output with the screen's status in its corner. */
export function ScreenView({ screenId, display, now }: { screenId: ScreenId; display: ScreenDisplay; now: number }) {
  switch (display.kind) {
    case "pairing":
      return (
        <ScreenPairing
          screenId={screenId}
          pairing={
            display.pairing && {
              code: display.pairing.code,
              expiresIn: formatLiveDuration(Math.max(0, Date.parse(display.pairing.expiresAt) - now)),
            }
          }
        />
      );
    case "waiting":
      return <ScreenWaiting screenId={screenId} name={display.name} marker={display.marker} />;
    case "livestream":
      return display.stream ? (
        <ScreenLivestreamPlayer
          videoId={display.stream.videoId}
          roomName={display.roomName}
          aside={<ScreenMarker marker={display.marker} placement="corner" />}
        />
      ) : (
        <ScreenWaiting
          screenId={screenId}
          name={display.name}
          status={`${display.roomName} · No livestream`}
          marker={display.marker}
        />
      );
    case "idle":
      return (
        <ScreenWaiting
          screenId={screenId}
          name={display.name}
          status={`${display.roomName} · Waiting for the studio`}
          marker={display.marker}
        />
      );
    case "output":
      return (
        <LiveOverlayPresentation
          view={display.output}
          layout={display.layout}
          projection={display.state}
          status={display.marker ? "offline" : "live"}
          roomId={display.roomId}
          broadcast
          playsSounds
          stageAside={<ScreenMarker marker={display.marker} />}
        >
          {display.output === "stage-display" ? null : <ScreenMarker marker={display.marker} placement="corner" />}
        </LiveOverlayPresentation>
      );
  }
}

/**
 * A venue screen: pairs, then shows what the studio assigned it, holding its
 * last good state through any outage and handing the device back to its
 * local status page only when it has nothing good to show.
 */
/** A page that still cannot read the room after one reload is not outdated: it tries again only after this long. */
const OUTDATED_RELOAD_EVERY_MS = 10 * 60_000;
const OUTDATED_RELOAD_KEY = "pkic.screen.outdatedReloadAt";

/** Loads the server's newer release, at most once a while, so a fault that is not a release never loops. */
export function reloadOutdatedPage(storage: Storage, reload: () => void) {
  try {
    const last = Number(storage.getItem(OUTDATED_RELOAD_KEY));
    if (Date.now() - last < OUTDATED_RELOAD_EVERY_MS) return;
    storage.setItem(OUTDATED_RELOAD_KEY, String(Date.now()));
  } catch {
    // Without a place to note the reload, it could loop: the screen keeps what it has.
    return;
  }
  reload();
}

export function ScreenApp({
  screenId,
  storage,
  clock,
  api,
  onHandoff,
  onReload = () => window.location.reload(),
  onOutdated = () => window.location.reload(),
  monitor,
  browser = null,
}: {
  screenId: ScreenId;
  storage: Storage;
  clock: ScreenClock;
  api?: ScreenApi;
  onHandoff: () => void;
  /** A screen manager's Reload. */
  onReload?: () => void;
  /** Loads the page again for the server's newer release, which a redraw does not. */
  onOutdated?: () => void;
  /** The monitor connection's socket and device readers, replaced in tests. */
  monitor?: Pick<Parameters<typeof useScreenMonitor>[0], "createSocket" | "readMetrics" | "readScreenshot">;
  /**
   * A browser screen's grants and tab capture. Without one the page runs on a
   * device and reads the device's local service; with one it never does.
   */
  browser?: BrowserScreen | null;
}) {
  const runtime = useScreenRuntime({ screenId, storage, clock, api });
  const { view, agenda, overlayToken, refresh } = runtime;
  const [live, setLive] = useState<HeldLive>(() => ({
    connected: false,
    lastUpdateAt: runtime.cached ? Date.parse(runtime.cached.savedAt) : null,
    state: liveStateFromCache(runtime.cached?.live ?? null),
  }));
  const now = useLiveTimerNow(true);
  const assignment = view?.screen.assignment ?? null;
  const feedKey = assignment ? `${assignment.eventSlug}:${assignment.roomId}:${assignment.output}` : null;
  const lastFeed = useRef(feedKey);
  useEffect(() => {
    // Another room or output: the old picture is not this assignment's.
    if (lastFeed.current !== null && lastFeed.current !== feedKey)
      setLive((held) => ({ ...held, connected: false, state: null }));
    lastFeed.current = feedKey;
  }, [feedKey]);

  const [studioRefusal, setStudioRefusal] = useState<string | null>(null);
  const onReport = useCallback((report: ScreenLiveReport) => {
    if (report.connected) setStudioRefusal(null);
    setLive((held) => ({
      connected: report.connected,
      lastUpdateAt: held.lastUpdateAt,
      state: report.state === undefined ? held.state : report.state,
    }));
  }, []);
  const outdated = useRef(onOutdated);
  outdated.current = onOutdated;
  const persistence = useMemo(
    () => ({
      onActivity: () => setLive((held) => ({ ...held, lastUpdateAt: clock.now() })),
      // The room speaks a newer release than this page: after a deploy, only a reload brings the screen back.
      onUnreadable: () => reloadOutdatedPage(storage, () => outdated.current()),
      // Expired access or a changed assignment: read again, which brings fresh access.
      onRefusal: (code: string) => {
        setStudioRefusal(code);
        if (code !== "LIVE_PROGRAM_SELECTION_CHANGED") void refresh();
      },
    }),
    [clock, refresh, storage],
  );

  const display = screenDisplay({
    now,
    pairingRequired: runtime.pairingRequired,
    pairing: runtime.pairing,
    view,
    agenda,
    read: runtime.read,
    live,
  });

  // The read's copy at once, the live picture at most every few seconds, whatever the pace of its updates.
  const latest = useRef({ view, agenda, state: live.state });
  latest.current = { view, agenda, state: live.state };
  const lastWrite = useRef(0);
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeCopy = useCallback(() => {
    pendingWrite.current = null;
    lastWrite.current = Date.now();
    const { view: kept, agenda: keptAgenda, state } = latest.current;
    if (!kept) return;
    writeScreenCache(storage, {
      version: 1,
      savedAt: new Date(clock.now()).toISOString(),
      view: cachedScreenView(kept),
      agenda: keptAgenda,
      live: state ? cachedLiveSnapshot(state) : null,
    });
  }, [storage, clock]);
  useEffect(() => {
    if (view) writeCopy();
  }, [view, agenda, writeCopy]);
  useEffect(() => {
    if (!live.state || pendingWrite.current) return;
    pendingWrite.current = setTimeout(writeCopy, Math.max(0, LIVE_CACHE_EVERY_MS - (Date.now() - lastWrite.current)));
  }, [live.state, writeCopy]);
  useEffect(() => () => clearTimeout(pendingWrite.current ?? undefined), []);

  useEffect(() => {
    document.documentElement.setAttribute(SCREEN_READY_ATTRIBUTE, "");
  }, []);

  const [player, setPlayer] = useState(livestreamPlayerReport);
  useEffect(() => subscribeLivestreamPlayerReport(setPlayer), []);
  const [identifyUntil, setIdentifyUntil] = useState<number | null>(null);
  const onCommand = useCallback(
    (command: ScreenManagerCommand) => {
      if (command.type === "screen.reload") onReload();
      else setIdentifyUntil(Date.parse(command.until));
    },
    [onReload],
  );
  const pageVersion = useMemo(() => screenPageVersion(), []);
  const grants = useBrowserScreenState(browser).state;
  const sound = browserScreenSound(display.kind === "livestream" ? player : null);
  // A browser screen has no device to read: no metrics, and screenshots from its own tab capture.
  const readers = useMemo(
    () => (browser ? { readMetrics: async () => null, readScreenshot: browser.readScreenshot } : {}),
    [browser],
  );
  useScreenMonitor({
    screenId,
    // Only a screen signed in has a sign-in to report with; one holding its device's copy may not be.
    enabled: !runtime.pairingRequired && view !== null,
    connection: assignment?.eventSlug ?? "",
    health: screenHealth({
      display,
      assignment,
      player,
      clockOffsetMs: clock.offset(),
      pageVersion,
      browser: grants ? { ...grants, sound } : null,
      studioRefusal,
    }),
    onCommand,
    ...readers,
    ...monitor,
  });
  // The monitor sets the end on the server's clock, which `now` follows.
  const identifying = identifyUntil !== null && now < identifyUntil;
  const hasGoodState = view !== null || live.state !== null;
  useEffect(() => {
    if (screenHandoffDue({ hasGoodState, unreachableSince: runtime.unreachableSince, now })) onHandoff();
  }, [hasGoodState, runtime.unreachableSince, now, onHandoff]);

  return (
    <>
      {assignment && assignment.output !== "livestream" && overlayToken ? (
        <ScreenLiveFeed
          key={feedKey}
          slug={assignment.eventSlug}
          roomId={assignment.roomId}
          output={assignment.output}
          token={overlayToken}
          persistence={persistence}
          onReport={onReport}
        />
      ) : null}
      <ScreenView screenId={screenId} display={display} now={now} />
      {identifying ? <ScreenIdentify screenId={screenId} name={view?.screen.name ?? null} /> : null}
      {browser ? <BrowserScreenResume browser={browser} sound={sound} /> : null}
    </>
  );
}
