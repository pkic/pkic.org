/**
 * A browser set up as a screen (a laptop at a stage instead of a device):
 * what its clicks grant it and what it keeps. It holds a screen wake lock
 * from the start, with no click; the setup click asks for full screen, then
 * a capture of this tab for staff's screenshots. Each may be refused on its
 * own; the screen runs without it, and its corner offers what the next
 * click can bring back. A reload takes full screen and the capture away
 * until someone clicks again. Sound is the livestream player's to confirm,
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
  /** A video and a canvas to take frames with. */
  frames: () => { video: FrameVideo; canvas: FrameCanvas & FrameDrawing };
}

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

export type BrowserScreenProblem = "fullscreen" | "wake-lock" | "capture" | "capture-surface";

export const browserPlatform = (): BrowserScreenPlatform => ({
  document,
  wakeLock: (navigator as { wakeLock?: ScreenWakeLockApi }).wakeLock,
  getDisplayMedia: navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices) as
    | BrowserScreenPlatform["getDisplayMedia"]
    | undefined,
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
  let state: BrowserScreenGrants = {
    fullscreen: Boolean(document.fullscreenElement),
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

  document.addEventListener("fullscreenchange", () => set({ fullscreen: Boolean(document.fullscreenElement) }));

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
    return document.fullscreenElement ? Promise.resolve() : attempt(() => document.documentElement.requestFullscreen());
  }

  async function capture(request: Promise<MediaStream> | null): Promise<BrowserScreenProblem | null> {
    if (!request) return "capture";
    let next: MediaStream;
    try {
      next = await request;
    } catch {
      return "capture";
    }
    const track = next.getVideoTracks()[0];
    // Only this tab: a window or a whole screen would show staff more than the screen.
    if (!track || track.getSettings().displaySurface !== "browser") {
      for (const each of next.getTracks()) each.stop();
      return "capture-surface";
    }
    endCapture("off");
    stream = next;
    track.addEventListener("ended", () => {
      if (stream === next) endCapture("stopped");
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
    const fullscreen = Boolean(document.fullscreenElement);
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
