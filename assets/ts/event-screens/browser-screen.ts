/**
 * A browser set up as a screen (a laptop at a stage instead of a device):
 * what its clicks grant it and what it keeps. The setup click asks for a
 * capture of this tab for staff's screenshots, then full screen, and takes a
 * screen wake lock. A browser that spends the click on the capture refuses
 * full screen; a second click in the screen's corner finishes it. Each may be
 * refused on its own; the screen runs without it and says what is missing. A
 * reload takes full screen and the capture away until the next click. Sound
 * is the livestream player's to confirm, not this click's.
 */
import type { ScreenBrowserState } from "../../shared/schemas/event-screen-monitor";
import { browserScreenFrameSize, encodeBrowserScreenFrame, type FrameCanvas } from "./browser-screen-frame";

/** What the clicks grant; the screen adds the livestream's sound, which its player confirms. */
export type BrowserScreenGrants = Omit<ScreenBrowserState, "sound">;

/** What the screen asks of the browser, replaced in tests. */
export interface BrowserScreenPlatform {
  document: Pick<Document, "fullscreenElement" | "visibilityState" | "addEventListener"> & {
    documentElement: Pick<HTMLElement, "requestFullscreen">;
  };
  wakeLock?: { request(type: "screen"): Promise<WakeLockLike> };
  getDisplayMedia?: (options: object) => Promise<MediaStream>;
  /** A video and a canvas to take frames with. */
  frames: () => { video: FrameVideo; canvas: FrameCanvas & FrameDrawing };
}

interface WakeLockLike {
  released: boolean;
  addEventListener(type: "release", listener: () => void): void;
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

export type BrowserScreenProblem = "fullscreen" | "wake-lock" | "capture" | "capture-surface";

export const browserPlatform = (): BrowserScreenPlatform => ({
  document,
  wakeLock: (navigator as { wakeLock?: BrowserScreenPlatform["wakeLock"] }).wakeLock,
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

  /** The wake lock needs no click, only a visible page; the browser drops it whenever the page is hidden. */
  async function keepAwake(): Promise<boolean> {
    if (!platform.wakeLock || document.visibilityState !== "visible") return false;
    try {
      const lock = await platform.wakeLock.request("screen");
      lock.addEventListener("release", () => set({ wakeLock: false }));
      set({ wakeLock: !lock.released });
      return !lock.released;
    } catch {
      set({ wakeLock: false });
      return false;
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.wakeLock) void keepAwake();
  });
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

  return {
    get: () => state,
    /** What the last click could not get, for the screen to say. */
    problems: () => problems,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /**
     * The setup click, and Resume's: the capture first, while the click still
     * counts as the person's, then full screen in the same handler, and the
     * wake lock. Full screen is read from the document once the capture
     * settles. Resolves with what is still missing; a refused full screen is
     * offered again in the screen's corner.
     */
    async enroll(): Promise<BrowserScreenProblem[]> {
      const captureRequest = platform.getDisplayMedia
        ? attempt(() => platform.getDisplayMedia!(BROWSER_SCREEN_CAPTURE_OPTIONS))
        : null;
      const fullscreenRequest = enterFullscreen();
      const [captured] = await Promise.allSettled([capture(captureRequest), fullscreenRequest, keepAwake()]);
      const missing: BrowserScreenProblem[] = [];
      const capturedProblem = captured.status === "fulfilled" ? captured.value : "capture";
      if (capturedProblem) missing.push(capturedProblem);
      const fullscreen = Boolean(document.fullscreenElement);
      if (!fullscreen) missing.push("fullscreen");
      if (!state.wakeLock) missing.push("wake-lock");
      set({ fullscreen }, missing);
      return missing;
    },
    /** A second click's full screen, for a browser that spent the first on the capture. */
    async requestFullscreen(): Promise<boolean> {
      await enterFullscreen().catch(() => undefined);
      const fullscreen = Boolean(document.fullscreenElement);
      set({ fullscreen }, fullscreen ? problems.filter((problem) => problem !== "fullscreen") : problems);
      return fullscreen;
    },
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
