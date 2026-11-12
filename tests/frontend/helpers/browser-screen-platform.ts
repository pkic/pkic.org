/** A browser for browser-screen tests: its grants, its activation, its wake lock and its tab capture. */
import { Blob as NodeBlob } from "node:buffer";
import { vi } from "vitest";
import type { BrowserScreenPlatform } from "../../../assets/ts/event-screens/browser-screen";

/**
 * A browser that grants or refuses each request as told. Full screen and
 * the capture each need a click's activation; `spends` says which request
 * uses it up, and `pickerExitsFullscreen` that showing the picker leaves
 * full screen. The wake lock is granted with no click, refused, or granted
 * only within one (`"needs-click"`); the browser lets it go when the page is
 * hidden, or whenever `systemRelease` says.
 */
export function fakePlatform(
  grants: {
    fullscreen?: boolean;
    wakeLock?: boolean | "needs-click";
    capture?: "tab" | "window" | "declined";
    spends?: "fullscreen" | "capture";
    pickerExitsFullscreen?: boolean;
  } = {},
) {
  const { fullscreen = true, wakeLock = true, capture = "tab", spends, pickerExitsFullscreen = false } = grants;
  const listeners = new Map<string, () => void>();
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(),
    getSettings: () => ({ displaySurface: capture === "tab" ? "browser" : "window" }),
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
    frames: () => ({
      video: { srcObject: null, muted: false, videoWidth: 1920, videoHeight: 1080, play: async () => undefined },
      canvas: Object.assign(fakeCanvas([["image/webp", 30_000]]), {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
      }),
    }),
  };
  /** A person's click: activation for the requests it starts. */
  const click = <T>(run: () => T): T => {
    active = true;
    return run();
  };
  const exitFullscreen = () => {
    doc.fullscreenElement = null;
    listeners.get("fullscreenchange")?.();
  };
  return {
    platform,
    track,
    getDisplayMedia,
    doc,
    click,
    exitFullscreen,
    requestWakeLock,
    systemRelease,
    setVisibility,
  };
}

/** A canvas whose encoder answers each request in turn with a blob of this type and size. */
export function fakeCanvas(answers: [type: string, size: number][]) {
  const asked: [string | undefined, number | undefined][] = [];
  let next = 0;
  return {
    asked,
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number) {
      asked.push([type, quality]);
      const [answer, size] = answers[Math.min(next++, answers.length - 1)]!;
      // Node's Blob, as jsdom's has no arrayBuffer().
      callback(new NodeBlob([new Uint8Array(size)], { type: answer }) as unknown as Blob);
    },
  };
}
