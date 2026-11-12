// @vitest-environment jsdom
/**
 * A browser set up as a screen: the one click that asks for everything, the
 * tab-only capture, its own screen ID, its screenshots, the Resume button,
 * and that it never reaches for a device's local service.
 */
import { Blob as NodeBlob } from "node:buffer";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCREEN_MONITOR_LIMITS } from "../../assets/shared/schemas/event-screen-monitor";
import { screenIdSchema, screenReadResponseSchema } from "../../assets/shared/schemas/event-screens";
import {
  BROWSER_SCREEN_CAPTURE_OPTIONS,
  createBrowserScreen,
  type BrowserScreenPlatform,
} from "../../assets/ts/event-screens/browser-screen";
import { BROWSER_SCREEN_FRAME, encodeBrowserScreenFrame } from "../../assets/ts/event-screens/browser-screen-frame";
import {
  BROWSER_SCREEN_ID_KEY,
  browserScreenId,
  generateBrowserScreenId,
} from "../../assets/ts/event-screens/browser-screen-id";
import { BrowserScreenEnroll } from "../../assets/ts/event-screens/BrowserScreenEnroll";
import { BrowserScreenResume } from "../../assets/ts/event-screens/BrowserScreenResume";
import type { ScreenApi } from "../../assets/ts/event-screens/screen-api";
import { ScreenApp } from "../../assets/ts/event-screens/ScreenApp";
import { createScreenClock } from "../../assets/ts/event-screens/screen-clock";
import { readScreenDeviceScreenshot } from "../../assets/ts/event-screens/screen-device-screenshot";
import { fakeLiveSockets } from "./helpers/live-room-socket";

/** A browser that grants or refuses each request as told. */
function fakePlatform(
  grants: { fullscreen?: boolean; sound?: boolean; wakeLock?: boolean; capture?: "tab" | "window" | "declined" } = {},
) {
  const { fullscreen = true, sound = true, wakeLock = true, capture = "tab" } = grants;
  const listeners = new Map<string, () => void>();
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(),
    getSettings: () => ({ displaySurface: capture === "tab" ? "browser" : "window" }),
  });
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  const doc = {
    fullscreenElement: null as Element | null,
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    documentElement: {
      requestFullscreen: vi.fn(async () => {
        if (!fullscreen) throw new Error("Refused");
        doc.fullscreenElement = {} as Element;
      }),
    },
  };
  const getDisplayMedia = vi.fn(async () => {
    if (capture === "declined") throw new DOMException("Denied", "NotAllowedError");
    return stream;
  });
  const platform: BrowserScreenPlatform = {
    document: doc as unknown as BrowserScreenPlatform["document"],
    wakeLock: {
      request: vi.fn(async () => {
        if (!wakeLock) throw new Error("Refused");
        return { released: false, addEventListener: () => undefined };
      }),
    },
    getDisplayMedia,
    unlockSound: vi.fn(async () => sound),
    hasBeenActive: () => false,
    frames: () => ({
      video: { srcObject: null, muted: false, videoWidth: 1920, videoHeight: 1080, play: async () => undefined },
      canvas: Object.assign(fakeCanvas([["image/webp", 30_000]]), {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
      }),
    }),
  };
  return { platform, track, getDisplayMedia, doc };
}

/** A canvas whose encoder answers each request in turn with a blob of this type and size. */
function fakeCanvas(answers: [type: string, size: number][]) {
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

let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) await act(() => render(null, host!));
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe("setting up a browser as a screen", () => {
  it("asks for everything in one click and keeps what was granted", async () => {
    const { platform, getDisplayMedia } = fakePlatform();
    const screen = createBrowserScreen(platform);
    expect(await screen.enroll()).toEqual([]);
    expect(getDisplayMedia).toHaveBeenCalledWith(BROWSER_SCREEN_CAPTURE_OPTIONS);
    expect(screen.get()).toEqual({ fullscreen: true, wakeLock: true, sound: true, capture: "live" });
  });

  it.each([
    [{ fullscreen: false }, ["fullscreen"], { fullscreen: false, capture: "live" }],
    [{ sound: false }, ["sound"], { sound: false }],
    [{ wakeLock: false }, ["wake-lock"], { wakeLock: false }],
    [{ capture: "declined" as const }, ["capture"], { capture: "off" }],
  ])("goes on without what is refused (%o) and says so", async (grants, problems, state) => {
    const { platform } = fakePlatform(grants);
    const screen = createBrowserScreen(platform);
    expect(await screen.enroll()).toEqual(problems);
    expect(screen.problems()).toEqual(problems);
    expect(screen.get()).toMatchObject(state);
  });

  it("goes on when the browser has no full screen at all", async () => {
    const { platform, doc } = fakePlatform();
    (doc.documentElement as { requestFullscreen?: unknown }).requestFullscreen = undefined;
    const screen = createBrowserScreen(platform);
    expect(await screen.enroll()).toEqual(["fullscreen"]);
    expect(screen.get().capture).toBe("live");
  });

  it("accepts a capture of this tab only, and reports when the person stops sharing", async () => {
    const window = fakePlatform({ capture: "window" });
    const refused = createBrowserScreen(window.platform);
    expect(await refused.enroll()).toEqual(["capture-surface"]);
    expect(window.track.stop).toHaveBeenCalled();
    expect(refused.get().capture).toBe("off");

    const tab = fakePlatform();
    const screen = createBrowserScreen(tab.platform);
    await screen.enroll();
    expect(screen.get().capture).toBe("live");
    tab.track.dispatchEvent(new Event("ended"));
    expect(screen.get().capture).toBe("stopped");
    expect(await screen.readScreenshot()).toBeNull();
  });

  it("takes a frame of its tab as a screenshot while it is shared", async () => {
    const { platform } = fakePlatform();
    const screen = createBrowserScreen(platform);
    expect(await screen.readScreenshot()).toBeNull();
    await screen.enroll();
    const frame = await screen.readScreenshot();
    expect(frame?.byteLength).toBe(30_000);
  });

  it("enrolls from the setup page's one button, then goes on", async () => {
    const enroll = vi.fn(async () => []);
    const onEnrolled = vi.fn();
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<BrowserScreenEnroll browser={{ enroll }} onEnrolled={onEnrolled} />, host!));
    expect(host.textContent).toContain("Set up this browser as a screen");
    await act(async () => {
      host!.querySelector("button")!.click();
    });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(onEnrolled).toHaveBeenCalledTimes(1);
  });
});

describe("a browser screen's own ID", () => {
  it("is six base32 characters from the secure source, kept in this browser", () => {
    const id = generateBrowserScreenId(() => Uint8Array.from([0, 31, 32, 63, 200, 255]));
    expect(id).toBe("A7A7I7");
    expect(screenIdSchema.safeParse(generateBrowserScreenId()).success).toBe(true);

    const generate = vi.fn(() => "K7M2QA" as const);
    expect(browserScreenId(localStorage, generate)).toBe("K7M2QA");
    expect(localStorage.getItem(BROWSER_SCREEN_ID_KEY)).toBe("K7M2QA");
    expect(browserScreenId(localStorage, generate)).toBe("K7M2QA");
    expect(generate).toHaveBeenCalledTimes(1);
    localStorage.setItem(BROWSER_SCREEN_ID_KEY, "not-an-id");
    expect(screenIdSchema.safeParse(browserScreenId(localStorage)).success).toBe(true);
  });
});

describe("a browser screen's screenshot encoding", () => {
  it("encodes WebP, falls back to JPEG where the browser cannot, and retries once when too large", async () => {
    const webp = fakeCanvas([["image/webp", 20_000]]);
    expect((await encodeBrowserScreenFrame(webp))?.byteLength).toBe(20_000);
    expect(webp.asked).toEqual([["image/webp", BROWSER_SCREEN_FRAME.quality]]);

    // A browser without a WebP encoder answers with PNG.
    const jpeg = fakeCanvas([
      ["image/png", 90_000],
      ["image/jpeg", 25_000],
    ]);
    expect((await encodeBrowserScreenFrame(jpeg))?.byteLength).toBe(25_000);
    expect(jpeg.asked.map(([type]) => type)).toEqual(["image/webp", "image/jpeg"]);

    const large = SCREEN_MONITOR_LIMITS.screenshotBytes + 1;
    const retried = fakeCanvas([
      ["image/webp", large],
      ["image/webp", 40_000],
    ]);
    expect((await encodeBrowserScreenFrame(retried))?.byteLength).toBe(40_000);
    expect(retried.asked).toEqual([
      ["image/webp", BROWSER_SCREEN_FRAME.quality],
      ["image/webp", BROWSER_SCREEN_FRAME.retryQuality],
    ]);
    expect(await encodeBrowserScreenFrame(fakeCanvas([["image/webp", large]]))).toBeNull();
  });
});

describe("after a reload", () => {
  it("offers one Resume button while anything is missing, which asks again", async () => {
    const { platform } = fakePlatform();
    const screen = createBrowserScreen(platform);
    const enroll = vi.spyOn(screen, "enroll");
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<BrowserScreenResume browser={screen} />, host!));
    const resume = host.querySelector<HTMLElement>(".pk-screen-resume");
    expect(resume?.querySelector("button")).not.toBeNull();
    await act(async () => {
      resume!.querySelector("button")!.click();
      await enroll.mock.results[0]!.value;
    });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".pk-screen-resume")).toBeNull();
  });
});

describe("the device's local service", () => {
  const response = screenReadResponseSchema.parse({
    viewer: "screen",
    screen: { id: "K7M2QA", name: "Laptop, stage left", assignment: null },
    serverNow: new Date().toISOString(),
    agenda: null,
    livestream: null,
    overlay: null,
  });
  const api = {
    read: vi.fn(async () => ({ response, sentAt: Date.now(), receivedAt: Date.now() })),
    startPairing: vi.fn(),
    pollSession: vi.fn(),
  } as unknown as ScreenApi;
  let fetches: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    fetches = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        fetches.push(String(input));
        return new Response(null, { status: 503 });
      }),
    );
  });
  async function run(browser: ReturnType<typeof createBrowserScreen> | null) {
    const sockets = fakeLiveSockets();
    host = document.body.appendChild(document.createElement("div"));
    await act(() =>
      render(
        <ScreenApp
          screenId="K7M2QA"
          storage={localStorage}
          clock={createScreenClock()}
          api={api}
          onHandoff={vi.fn()}
          monitor={{ createSocket: sockets.factory }}
          browser={browser}
        />,
        host!,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => sockets.latest().open());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    return sockets;
  }
  const local = () => fetches.filter((url) => url.startsWith("http://127.0.0.1"));

  it("is never reached from a browser screen, which reports as one", async () => {
    const { platform } = fakePlatform();
    const sockets = await run(createBrowserScreen(platform));
    expect(local()).toEqual([]);
    const reports = (sockets.latest().sent as unknown[])
      .filter((data): data is string => typeof data === "string" && data.startsWith("{"))
      .map((data) => JSON.parse(data) as { health: { kind: string; browser: unknown } });
    expect(reports[0]?.health).toMatchObject({ kind: "browser", browser: { capture: "off", fullscreen: false } });
  });

  it("is read on a device, for its metrics and screenshot", async () => {
    await run(null);
    expect(local()).toEqual(
      expect.arrayContaining(["http://127.0.0.1:8080/metrics", "http://127.0.0.1:8080/screenshot"]),
    );
  });

  it("is read as WebP or JPEG by its bytes, and nothing else", async () => {
    const answer = (bytes: number[]) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(Uint8Array.from(bytes), { status: 200 })),
      );
    answer([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);
    expect((await readScreenDeviceScreenshot())?.byteLength).toBe(13);
    answer([0xff, 0xd8, 0xff, 0xe0, 0]);
    expect((await readScreenDeviceScreenshot())?.byteLength).toBe(5);
    answer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(await readScreenDeviceScreenshot()).toBeNull();
  });
});
