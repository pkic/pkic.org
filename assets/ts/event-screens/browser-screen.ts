/**
 * A browser set up as a screen (a laptop at a stage instead of a device):
 * what its clicks grant it and what it keeps. It holds a screen wake lock
 * from the start, with no click; the setup click asks for full screen, then
 * a capture of this tab for staff's screenshots. Each may be refused on its
 * own; the screen runs without it, and its corner offers what the next
 * click can bring back. A reload takes page full screen and the capture
 * away until someone clicks again; the browser's own full screen (F11, or
 * Control-Command-F on a Mac) counts as full screen and survives a reload.
 * While full screen is missing, a click anywhere on the screen asks for it. Sound is the livestream player's to confirm,
 * not a click's.
 */
import type { ScreenBrowserState } from "../../shared/schemas/event-screen-monitor";
import { screenWakeLock, type ScreenWakeLockApi } from "../shared/screen-wake-lock";
import { browserScreenFrameSize, encodeBrowserScreenFrame, type FrameCanvas } from "./browser-screen-frame";

/** What the clicks grant; the screen adds the livestream's sound, which its player confirms. */
export type BrowserScreenGrants = Omit<ScreenBrowserState, "sound">;

/** What the screen asks of the browser, replaced in tests. */
export interface BrowserScreenPlatform {
  document: Pick<Document, "fullscreenElement" | "visibilityState" | "addEventListener"> & {
    documentElement: Pick<HTMLElement, "requestFullscreen">;
  };
  wakeLock?: ScreenWakeLockApi;
  getDisplayMedia?: (options: object) => Promise<MediaStream>;
  /**
   * Whether the browser window itself is full screen (F11), which the page's
   * own full screen API does not report; absent in tests that leave it out.
   */
  windowFullscreen?: { matches: () => boolean; onChange: (listener: () => void) => void };
  /** This page's origin, which a capture of this tab reports with its handle. */
  origin: string;
  /**
   * Marks this tab with a handle a capture of it reports, telling it from
   * another tab the person picked; absent where the browser has no capture
   * handles.
   */
  setCaptureHandleConfig?: (config: CaptureHandleConfig) => void;
  /** A fresh, unguessable handle for this page load. */
  randomHandle: () => string;
  /** A video and a canvas to take frames with. */
  frames: () => { video: FrameVideo; canvas: FrameCanvas & FrameDrawing };
}

interface CaptureHandleConfig {
  handle: string;
  exposeOrigin: boolean;
  permittedOrigins: string[];
}
/** A captured tab's track, with the handle and origin of the tab it shows where the browser reports them. */
type CapturedTrack = MediaStreamTrack & {
  getCaptureHandle?: () => { handle?: string; origin?: string } | null;
};

export interface FrameVideo {
  srcObject: MediaProvider | null;
  muted: boolean;
  videoWidth: number;
  videoHeight: number;
  play(): Promise<void>;
}
interface FrameDrawing {
  width: number;
  height: number;
  getContext(type: "2d"): { drawImage(image: FrameVideo, x: number, y: number, w: number, h: number): void } | null;
}

/**
 * The capture asks for this tab and nothing else: the browser offers the
 * current tab first, and windows, other tabs and whole screens are refused
 * after the fact by the surface the capture reports.
 */
export const BROWSER_SCREEN_CAPTURE_OPTIONS = {
  video: true,
  audio: false,
  preferCurrentTab: true,
  selfBrowserSurface: "include",
  surfaceSwitching: "exclude",
  monitorTypeSurfaces: "exclude",
} as const;

/** A wake lock the system let go is asked for again after this long, so a browser that keeps letting go is not asked in a loop. */
export const BROWSER_SCREEN_WAKE_LOCK_RETRY_MS = 1_000;

export type BrowserScreenProblem =
  | "fullscreen"
  | "wake-lock"
  | "capture"
  | "capture-surface"
  | "capture-other-tab"
  | "capture-unverified";

/** Why a capture was refused after the person picked it, for the corner to say instead of what is missing. */
export const BROWSER_SCREEN_CAPTURE_REFUSALS = [
  "capture-surface",
  "capture-other-tab",
  "capture-unverified",
] as const satisfies readonly BrowserScreenProblem[];

/** The window fills the screen: the browser's own full screen, as F11 gives it. */
function windowFillsScreen(): boolean {
  if (matchMedia("(display-mode: fullscreen)").matches) return true;
  return innerWidth >= screen.width && innerHeight >= screen.height;
}

export const browserPlatform = (): BrowserScreenPlatform => ({
  document,
  windowFullscreen: {
    matches: windowFillsScreen,
    onChange: (listener) => {
      addEventListener("resize", listener);
      matchMedia("(display-mode: fullscreen)").addEventListener("change", listener);
    },
  },
  wakeLock: (navigator as { wakeLock?: ScreenWakeLockApi }).wakeLock,
  getDisplayMedia: navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices) as
    | BrowserScreenPlatform["getDisplayMedia"]
    | undefined,
  origin: location.origin,
  setCaptureHandleConfig: (
    navigator.mediaDevices as { setCaptureHandleConfig?: (config: CaptureHandleConfig) => void } | undefined
  )?.setCaptureHandleConfig?.bind(navigator.mediaDevices),
  randomHandle: () => crypto.randomUUID(),
  frames: () => ({
    video: document.createElement("video"),
    canvas: document.createElement("canvas") as HTMLCanvasElement as FrameCanvas & FrameDrawing,
  }),
});

/** A request a browser may not offer at all, or refuse before it even starts, as a promise either way. */
function attempt<T>(request: () => Promise<T>): Promise<T> {
  try {
    return request();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

export type BrowserScreen = ReturnType<typeof createBrowserScreen>;

export function createBrowserScreen(platform: BrowserScreenPlatform = browserPlatform()) {
  const { document } = platform;
  /** Full screen either way: the page's own, or the browser window's (F11). */
  const isFullscreen = () => Boolean(document.fullscreenElement) || Boolean(platform.windowFullscreen?.matches());
  let state: BrowserScreenGrants = {
    fullscreen: isFullscreen(),
    wakeLock: false,
    capture: "off",
  };
  let problems: BrowserScreenProblem[] = [];
  let stream: MediaStream | null = null;
  let frames: ReturnType<BrowserScreenPlatform["frames"]> | null = null;
  const listeners = new Set<() => void>();

  function set(next: Partial<BrowserScreenGrants>, nextProblems = problems) {
    const changed = Object.entries(next).some(([key, value]) => state[key as keyof BrowserScreenGrants] !== value);
    if (!changed && nextProblems === problems) return;
    state = { ...state, ...next };
    problems = nextProblems;
    for (const listener of listeners) listener();
  }

  const readFullscreen = () => set({ fullscreen: isFullscreen() });
  document.addEventListener("fullscreenchange", readFullscreen);
  platform.windowFullscreen?.onChange(readFullscreen);
  // A click anywhere asks for full screen while it is missing: the capture's picker in the setup click
  // often drops it, and a big screen is easier to click than its corner.
  document.addEventListener("click", () => {
    if (!state.fullscreen) void enterFullscreen().then(readFullscreen, () => undefined);
  });

  /**
   * Kept awake from the start, with no click: the wake lock needs only a
   * visible page. The browser lets it go whenever the page is hidden, and
   * may at any time; it is asked for again once the page is visible, and a
   * click asks once more if the browser wanted one.
   */
  const awake = screenWakeLock((wakeLock) => set({ wakeLock }), {
    wakeLock: () => platform.wakeLock,
    onReleased: () => setTimeout(() => void keepAwake(), BROWSER_SCREEN_WAKE_LOCK_RETRY_MS),
  });
  async function keepAwake(): Promise<boolean> {
    if (document.visibilityState !== "visible") return false;
    const held = await awake.acquire();
    // Refused while visible: a click may be what the browser wants, so the next one offers it.
    const refused = !held && Boolean(platform.wakeLock);
    if (refused !== problems.includes("wake-lock"))
      set({}, refused ? [...problems, "wake-lock"] : problems.filter((problem) => problem !== "wake-lock"));
    return held;
  }
  document.addEventListener("visibilitychange", () => void keepAwake());
  void keepAwake();

  function endCapture(next: BrowserScreenGrants["capture"]) {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    if (frames) frames.video.srcObject = null;
    set({ capture: next });
  }

  /** Already full screen counts as granted; a browser without full screen refuses it like any other. */
  function enterFullscreen(): Promise<void> {
    return isFullscreen() ? Promise.resolve() : attempt(() => document.documentElement.requestFullscreen());
  }

  /**
   * This tab's handle, set once per page load before any capture, or null
   * where the browser cannot set one; a capture is then never sent.
   */
  const handle = ((): string | null => {
    if (!platform.setCaptureHandleConfig) return null;
    const fresh = platform.randomHandle();
    try {
      platform.setCaptureHandleConfig({ handle: fresh, exposeOrigin: true, permittedOrigins: [platform.origin] });
      return fresh;
    } catch {
      return null;
    }
  })();

  /** Why this capture does not show this screen's tab, or null when it does. */
  function thisTabRefusal(track: CapturedTrack): BrowserScreenProblem | null {
    if (!handle || !track.getCaptureHandle) return "capture-unverified";
    const captured = track.getCaptureHandle();
    return captured?.handle === handle && captured.origin === platform.origin ? null : "capture-other-tab";
  }

  async function capture(request: Promise<MediaStream> | null): Promise<BrowserScreenProblem | null> {
    if (!request) return "capture";
    let next: MediaStream;
    try {
      next = await request;
    } catch {
      return "capture";
    }
    const track = next.getVideoTracks()[0] as CapturedTrack | undefined;
    // Only this tab: a window or a whole screen would show staff more than the screen.
    if (!track || track.getSettings().displaySurface !== "browser") {
      for (const each of next.getTracks()) each.stop();
      return "capture-surface";
    }
    // Only this screen's tab: another tab (an inbox, say) would reach staff too.
    const refused = thisTabRefusal(track);
    if (refused) {
      for (const each of next.getTracks()) each.stop();
      return refused;
    }
    endCapture("off");
    stream = next;
    track.addEventListener("ended", () => {
      if (stream === next) endCapture("stopped");
    });
    // The captured tab could change what it says it is; a capture that no longer shows this screen ends.
    track.addEventListener("capturehandlechange", () => {
      const changed = stream === next ? thisTabRefusal(track) : null;
      if (!changed) return;
      endCapture("stopped");
      set({}, [...problems.filter((problem) => problem !== changed), changed]);
    });
    frames ??= platform.frames();
    frames.video.muted = true;
    frames.video.srcObject = next;
    void frames.video.play().catch(() => undefined);
    set({ capture: "live" });
    return null;
  }

  /**
   * What one click asks for, in the order browsers allow: full screen
   * first (it prompts for nothing, so the click grants it), then the
   * capture in the same handler, and the wake lock. A browser may refuse
   * the capture for want of the click, and its picker may drop full
   * screen; neither is a failure. Once the capture settles, full screen is
   * read from the document and whatever is still missing is left for the
   * next click. Resolves with what is missing.
   */
  async function request(asked: { fullscreen?: boolean; capture?: boolean }): Promise<BrowserScreenProblem[]> {
    const fullscreenRequest = asked.fullscreen ? enterFullscreen() : Promise.resolve();
    const captureRequest =
      asked.capture && platform.getDisplayMedia
        ? attempt(() => platform.getDisplayMedia!(BROWSER_SCREEN_CAPTURE_OPTIONS))
        : null;
    const [captured] = await Promise.allSettled([
      asked.capture ? capture(captureRequest) : Promise.resolve(null),
      fullscreenRequest,
      keepAwake(),
    ]);
    const missing: BrowserScreenProblem[] = [];
    const capturedProblem = captured.status === "fulfilled" ? captured.value : "capture";
    if (capturedProblem) missing.push(capturedProblem);
    else if (state.capture !== "live") missing.push("capture");
    // The picker may have dropped full screen; ask once more while the click may still allow it.
    if (asked.fullscreen && !isFullscreen()) await enterFullscreen().catch(() => undefined);
    const fullscreen = isFullscreen();
    if (!fullscreen) missing.push("fullscreen");
    if (!state.wakeLock && platform.wakeLock) missing.push("wake-lock");
    set({ fullscreen }, missing);
    return missing;
  }

  return {
    get: () => state,
    /** What the last click could not get, for the screen to say. */
    problems: () => problems,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    request,
    /** The setup click, and Resume's: full screen and this tab's capture. */
    enroll: () => request({ fullscreen: true, capture: true }),
    /** One frame of this tab while it is captured, as the monitor takes a screenshot; null otherwise. */
    async readScreenshot(): Promise<ArrayBuffer | null> {
      if (state.capture !== "live" || !frames) return null;
      const size = browserScreenFrameSize(frames.video);
      const context = size ? frames.canvas.getContext("2d") : null;
      if (!size || !context) return null;
      frames.canvas.width = size.width;
      frames.canvas.height = size.height;
      context.drawImage(frames.video, 0, 0, size.width, size.height);
      return encodeBrowserScreenFrame(frames.canvas);
    },
  };
}

/** The livestream's sound as its player confirms it: unmuted and playing, blocked (muted), starting, or no player. */
export function browserScreenSound(player: { status: string; muted: boolean } | null): ScreenBrowserState["sound"] {
  if (!player) return "none";
  if (player.muted) return "blocked";
  return player.status === "playing" ? "on" : "starting";
}
