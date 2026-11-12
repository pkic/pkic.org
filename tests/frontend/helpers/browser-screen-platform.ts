/** A browser for browser-screen tests: its grants, its activation, its wake lock and its tab capture. */
import { Blob as NodeBlob } from "node:buffer";
import { vi } from "vitest";
import type { BrowserScreenPlatform } from "../../../assets/ts/event-screens/browser-screen";

/**
 * A browser that grants or refuses each request as told. Full screen and
 * the capture each need a click's activation; `spends` says which request
 * uses it up, and `pickerExitsFullscreen` that showing the picker leaves
 * full screen; activation ends when the click's handler returns. The
 * capture shows this tab, another tab, a window, or is declined; a browser
 * without capture handles (`captureHandles: false`) cannot say which tab it
 * shows. The wake lock is granted with no click, refused, or granted
 * only within one (`"needs-click"`); the browser lets it go when the page is
 * hidden, or whenever `systemRelease` says.
 */
export function fakePlatform(
  grants: {
    fullscreen?: boolean;
    wakeLock?: boolean | "needs-click";
    capture?: "tab" | "other-tab" | "window" | "declined";
    captureHandles?: boolean;
    spends?: "fullscreen" | "capture";
    pickerExitsFullscreen?: boolean;
  } = {},
) {
  const {
    fullscreen = true,
    wakeLock = true,
    capture = "tab",
    captureHandles = true,
    spends,
    pickerExitsFullscreen = false,
  } = grants;
  const origin = "https://pkic.example";
  const listeners = new Map<string, () => void>();
  /** What this tab set as its handle, which a capture of it reports. */
  let configured: { handle: string; permittedOrigins: string[] } | null = null;
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(),
    getSettings: () => ({ displaySurface: capture === "window" ? "window" : "browser" }),
    ...(captureHandles && {
      getCaptureHandle: () =>
        capture === "other-tab"
          ? { handle: "another-page", origin }
          : configured && { handle: configured.handle, origin },
    }),
  });
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  let active = false;
  const doc = {
    fullscreenElement: null as Element | null,
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    documentElement: {
      requestFullscreen: vi.fn((): Promise<void> => {
        if (!fullscreen || !active) return Promise.reject(new TypeError("Not allowed"));
        if (spends === "fullscreen") active = false;
        doc.fullscreenElement = {} as Element;
        return Promise.resolve();
      }),
    },
  };
  let held: (EventTarget & { released: boolean; release: () => Promise<void> }) | null = null;
  const requestWakeLock = vi.fn(async () => {
    if (!wakeLock || (wakeLock === "needs-click" && !active)) throw new DOMException("Refused", "NotAllowedError");
    const lock = Object.assign(new EventTarget(), {
      released: false,
      async release() {
        if (lock.released) return;
        lock.released = true;
        lock.dispatchEvent(new Event("release"));
      },
    });
    held = lock;
    return lock;
  });
  const systemRelease = () => void held?.release();
  const setVisibility = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    if (state === "hidden") systemRelease();
    listeners.get("visibilitychange")?.();
  };
  let pending: (() => void) | null = null;
  const getDisplayMedia = vi.fn((): Promise<MediaStream> => {
    if (!active) return Promise.reject(new DOMException("No user activation", "InvalidStateError"));
    if (spends === "capture") active = false;
    if (pickerExitsFullscreen && doc.fullscreenElement) {
      doc.fullscreenElement = null;
      listeners.get("fullscreenchange")?.();
    }
    if (capture === "declined") return Promise.reject(new DOMException("Denied", "NotAllowedError"));
    return new Promise((resolve) => {
      pending = () => resolve(stream);
      queueMicrotask(() => pending?.());
    });
  });
  const platform: BrowserScreenPlatform = {
    document: doc as unknown as BrowserScreenPlatform["document"],
    wakeLock: { request: requestWakeLock },
    getDisplayMedia,
    origin,
    setCaptureHandleConfig: captureHandles
      ? vi.fn((config: { handle: string; permittedOrigins: string[] }) => {
          configured = config;
        })
      : undefined,
    randomHandle: () => crypto.randomUUID(),
    frames: () => ({
      video: { srcObject: null, muted: false, videoWidth: 1920, videoHeight: 1080, play: async () => undefined },
      canvas: Object.assign(fakeCanvas([["image/webp", 30_000]]), {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
      }),
    }),
  };
  /** A person's click: activation for the requests its handler starts, and none after it returns. */
  const click = <T>(run: () => T): T => {
    active = true;
    try {
      return run();
    } finally {
      active = false;
    }
  };
  const exitFullscreen = () => {
    doc.fullscreenElement = null;
    listeners.get("fullscreenchange")?.();
  };
  /** The tab's handle changes, as when the captured page navigates. */
  const changeHandle = () => {
    configured = configured && { ...configured, handle: "navigated" };
    track.dispatchEvent(new Event("capturehandlechange"));
  };
  return {
    platform,
    track,
    changeHandle,
    configured: () => configured,
    getDisplayMedia,
    doc,
    click,
    exitFullscreen,
    requestWakeLock,
    systemRelease,
    setVisibility,
  };
}

/** Image bytes of this type and size, with the type's real leading signature. */
export function fakeImageBytes(type: string, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  if (type === "image/webp")
    bytes.set(
      [..."RIFF"].map((c) => c.charCodeAt(0)),
      0,
    );
  if (type === "image/webp")
    bytes.set(
      [..."WEBPVP8 "].map((c) => c.charCodeAt(0)),
      8,
    );
  if (type === "image/jpeg") bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

/** A canvas whose encoder answers each request in turn with an image of this type and size. */
export function fakeCanvas(answers: [type: string, size: number][]) {
  const asked: [string | undefined, number | undefined][] = [];
  let next = 0;
  return {
    asked,
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number) {
      asked.push([type, quality]);
      const [answer, size] = answers[Math.min(next++, answers.length - 1)]!;
      // Node's Blob, as jsdom's has no arrayBuffer().
      callback(new NodeBlob([fakeImageBytes(answer, size)], { type: answer }) as unknown as Blob);
    },
  };
}
