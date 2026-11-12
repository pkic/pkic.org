/**
 * A browser set up as a screen (a laptop at a stage instead of a device):
 * what one click grants it and what it keeps. The click asks, all at once,
 * for full screen, a screen wake lock, sound for the livestream and a
 * capture of this tab for staff's screenshots. Each may be refused on its
 * own; the screen runs without it and says what is missing. A reload takes
 * full screen, sound and the capture away until the next click.
 */
import type { ScreenBrowserState } from "../../shared/schemas/event-screen-monitor";
import { browserScreenFrameSize, encodeBrowserScreenFrame, type FrameCanvas } from "./browser-screen-frame";
import { requestLivestreamSound } from "./livestream-player-report";

/** What the screen asks of the browser, replaced in tests. */
export interface BrowserScreenPlatform {
  document: Pick<Document, "fullscreenElement" | "visibilityState" | "addEventListener"> & {
    documentElement: Pick<HTMLElement, "requestFullscreen">;
  };
  wakeLock?: { request(type: "screen"): Promise<WakeLockLike> };
  getDisplayMedia?: (options: object) => Promise<MediaStream>;
  /** A sound context started by the click; resolves true once it runs. */
  unlockSound: () => Promise<boolean>;
  /** Whether the page has had a click since it loaded. */
  hasBeenActive: () => boolean;
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

export type BrowserScreenProblem = "fullscreen" | "wake-lock" | "sound" | "capture" | "capture-surface";

const unlockWithAudioContext = async () => {
  const Context = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return false;
  const context = new Context();
  try {
    await context.resume();
    return context.state === "running";
  } finally {
    void context.close();
  }
};

export const browserPlatform = (): BrowserScreenPlatform => ({
  document,
  wakeLock: (navigator as { wakeLock?: BrowserScreenPlatform["wakeLock"] }).wakeLock,
  getDisplayMedia: navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices) as
    | BrowserScreenPlatform["getDisplayMedia"]
    | undefined,
  unlockSound: unlockWithAudioContext,
  hasBeenActive: () =>
    (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? false,
  frames: () => ({
    video: document.createElement("video"),
    canvas: document.createElement("canvas") as HTMLCanvasElement as FrameCanvas & FrameDrawing,
  }),
});

export type BrowserScreen = ReturnType<typeof createBrowserScreen>;

export function createBrowserScreen(platform: BrowserScreenPlatform = browserPlatform()) {
  const { document } = platform;
  let state: ScreenBrowserState = {
    fullscreen: Boolean(document.fullscreenElement),
    wakeLock: false,
    sound: platform.hasBeenActive(),
    capture: "off",
  };
  let problems: BrowserScreenProblem[] = [];
  let stream: MediaStream | null = null;
  let frames: ReturnType<BrowserScreenPlatform["frames"]> | null = null;
  const listeners = new Set<() => void>();

  function set(next: Partial<ScreenBrowserState>, nextProblems = problems) {
    const changed = Object.entries(next).some(([key, value]) => state[key as keyof ScreenBrowserState] !== value);
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

  function endCapture(next: ScreenBrowserState["capture"]) {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    if (frames) frames.video.srcObject = null;
    set({ capture: next });
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
     * Everything one click grants, asked for at once while the click still
     * counts as the person's: the browser forgets the click after the first
     * request that waits. Resolves with what is still missing.
     */
    async enroll(): Promise<BrowserScreenProblem[]> {
      const requests = {
        capture: platform.getDisplayMedia ? platform.getDisplayMedia(BROWSER_SCREEN_CAPTURE_OPTIONS) : null,
        fullscreen: document.fullscreenElement
          ? Promise.resolve()
          : document.documentElement.requestFullscreen().then(() => undefined),
        sound: platform.unlockSound(),
        wakeLock: keepAwake(),
      };
      requestLivestreamSound();
      const [captured, fullscreen, sound, awake] = await Promise.allSettled([
        capture(requests.capture),
        requests.fullscreen,
        requests.sound,
        requests.wakeLock,
      ]);
      const missing: BrowserScreenProblem[] = [];
      const capturedProblem = captured.status === "fulfilled" ? captured.value : "capture";
      if (capturedProblem) missing.push(capturedProblem);
      if (fullscreen.status === "rejected") missing.push("fullscreen");
      if (sound.status === "rejected" || !sound.value) missing.push("sound");
      if (awake.status === "rejected" || !awake.value) missing.push("wake-lock");
      set(
        {
          fullscreen: Boolean(document.fullscreenElement) || fullscreen.status === "fulfilled",
          sound: sound.status === "fulfilled" && sound.value,
        },
        missing,
      );
      return missing;
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
