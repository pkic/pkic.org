// @vitest-environment jsdom
/**
 * A browser set up as a screen: the one click that asks for everything, the
 * tab-only capture, its own screen ID, its screenshots, the Resume button,
 * and that it never reaches for a device's local service.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCREEN_MONITOR_LIMITS, screenScreenshotFormat } from "../../assets/shared/schemas/event-screen-monitor";
import { screenIdSchema, screenReadResponseSchema } from "../../assets/shared/schemas/event-screens";
import {
  BROWSER_SCREEN_CAPTURE_OPTIONS,
  BROWSER_SCREEN_WAKE_LOCK_RETRY_MS,
  browserScreenSound,
  createBrowserScreen,
} from "../../assets/ts/event-screens/browser-screen";
import { browserScreenNextClick } from "../../assets/ts/event-screens/browser-screen-copy";
import { browserScreenAddress, parseScreenPageAddress } from "../../assets/ts/event-screens/screen-address";
import { memoryStorage, screenStorage } from "../../assets/ts/event-screens/screen-storage";
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
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { fakeCanvas, fakePlatform } from "./helpers/browser-screen-platform";
import { fakeLiveSockets } from "./helpers/live-room-socket";

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
  it("shares this tab in the setup click, then goes full screen on the next click anywhere", async () => {
    const { platform, getDisplayMedia, doc, click, clickPage } = fakePlatform();
    const screen = createBrowserScreen(platform);
    const enrolled = click(() => screen.enroll());
    // The setup click reaches the page too, while the picker is open: it must not ask for full screen.
    clickPage();
    expect(await enrolled).toEqual(["fullscreen"]);
    expect(getDisplayMedia).toHaveBeenCalledWith(BROWSER_SCREEN_CAPTURE_OPTIONS);
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(screen.get()).toEqual({ fullscreen: false, wakeLock: true, capture: "live" });
    clickPage();
    await Promise.resolve();
    expect(screen.get().fullscreen).toBe(true);
  });

  async function corner(screen: ReturnType<typeof createBrowserScreen>, sound: "none" | "blocked" = "none") {
    host ??= document.body.appendChild(document.createElement("div"));
    await act(() => render(<BrowserScreenResume browser={screen} sound={sound} />, host!));
    return host.querySelector<HTMLButtonElement>(".pk-screen-resume button");
  }
  async function press(click: (run: () => void) => void, button: HTMLButtonElement) {
    await act(async () => {
      click(() => button.click());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("offers Full screen in the corner once the tab is shared", async () => {
    const { platform, click } = fakePlatform();
    const screen = createBrowserScreen(platform);
    expect(await click(() => screen.enroll())).toEqual(["fullscreen"]);
    expect(screen.get()).toMatchObject({ fullscreen: false, capture: "live" });
    const action = (await corner(screen))!;
    expect(action.textContent).toBe("Full screen");
    await press(click, action);
    expect(screen.get().fullscreen).toBe(true);
    expect(screen.problems()).toEqual([]);
    expect(host!.querySelector(".pk-screen-resume")).toBeNull();
  });

  it("counts the browser's own full screen (F11), which a reload keeps", async () => {
    const { platform, click, setWindowFullscreen } = fakePlatform({ fullscreen: false, windowFullscreen: true });
    const screen = createBrowserScreen(platform);
    expect(screen.get().fullscreen).toBe(true);
    expect(await click(() => screen.enroll())).toEqual([]);
    setWindowFullscreen(false);
    expect(screen.get().fullscreen).toBe(false);
  });

  it("reads full screen from the document once the capture settles", async () => {
    const { platform, click, doc, exitFullscreen } = fakePlatform();
    doc.fullscreenElement = {} as Element;
    const screen = createBrowserScreen(platform);
    const enrolled = click(() => screen.enroll());
    // The person leaves full screen while the capture picker is open.
    exitFullscreen();
    expect(await enrolled).toEqual(["fullscreen"]);
    expect(screen.get().fullscreen).toBe(false);
  });

  it.each([
    [{ fullscreen: false }, ["fullscreen"], { fullscreen: false, capture: "live" }],
    [{ wakeLock: false }, ["fullscreen", "wake-lock"], { wakeLock: false }],
    [{ capture: "declined" as const }, ["capture", "fullscreen"], { capture: "off", fullscreen: false }],
  ])("goes on without what is refused (%o) and says so", async (grants, problems, state) => {
    const { platform, click } = fakePlatform(grants);
    const screen = createBrowserScreen(platform);
    expect(await click(() => screen.enroll())).toEqual(problems);
    expect(screen.problems()).toEqual(problems);
    expect(screen.get()).toMatchObject(state);
  });

  it("goes on when the browser has no full screen at all", async () => {
    const { platform, doc, click } = fakePlatform();
    (doc.documentElement as { requestFullscreen?: unknown }).requestFullscreen = undefined;
    const screen = createBrowserScreen(platform);
    expect(await click(() => screen.enroll())).toEqual(["fullscreen"]);
    expect(screen.get().capture).toBe("live");
  });

  it("accepts a capture of this tab only, and reports when the person stops sharing", async () => {
    const window = fakePlatform({ capture: "window" });
    const refused = createBrowserScreen(window.platform);
    expect(await window.click(() => refused.enroll())).toEqual(["capture-surface", "fullscreen"]);
    expect(window.track.stop).toHaveBeenCalled();
    expect(refused.get().capture).toBe("off");

    const tab = fakePlatform();
    const screen = createBrowserScreen(tab.platform);
    await tab.click(() => screen.enroll());
    expect(screen.get().capture).toBe("live");
    tab.track.dispatchEvent(new Event("ended"));
    expect(screen.get().capture).toBe("stopped");
    expect(await screen.readScreenshot()).toBeNull();
  });

  it("marks this tab before the capture and sends only a capture that shows it", async () => {
    const { platform, click, getDisplayMedia, configured } = fakePlatform();
    const screen = createBrowserScreen(platform);
    expect(configured()).toMatchObject({ exposeOrigin: true, permittedOrigins: [platform.origin] });
    // A fresh handle for each page load.
    const other = fakePlatform();
    createBrowserScreen(other.platform);
    expect(other.configured()!.handle).not.toBe(configured()!.handle);
    expect(platform.setCaptureHandleConfig).toHaveBeenCalledTimes(1);
    expect(await click(() => screen.enroll())).toEqual(["fullscreen"]);
    expect(getDisplayMedia).toHaveBeenCalled();
    expect(screen.get().capture).toBe("live");
  });

  it.each([
    ["another tab", { capture: "other-tab" as const }, "capture-other-tab", "Wrong tab shared"],
    ["a browser that cannot tell", { captureHandles: false }, "capture-unverified", "Tab can't be verified"],
  ])("refuses %s, sends nothing and offers Share this tab again", async (_case, grants, problem, says) => {
    const { platform, click, track } = fakePlatform(grants);
    const screen = createBrowserScreen(platform);
    expect(await click(() => screen.enroll())).toEqual([problem, "fullscreen"]);
    expect(track.stop).toHaveBeenCalled();
    expect(screen.get().capture).toBe("off");
    expect(await screen.readScreenshot()).toBeNull();
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<BrowserScreenResume browser={screen} sound="none" />, host!));
    expect(host.querySelector(".pk-screen-resume__missing")?.textContent).toBe(says);
    expect(host.querySelector(".pk-screen-resume button")?.textContent).toBe("Share this tab");
  });

  it("ends a capture whose tab stops saying it is this screen", async () => {
    const { platform, click, track, changeHandle } = fakePlatform();
    const screen = createBrowserScreen(platform);
    await click(() => screen.enroll());
    changeHandle();
    expect(screen.get().capture).toBe("stopped");
    expect(screen.problems()).toContain("capture-other-tab");
    expect(track.stop).toHaveBeenCalled();
    expect(await screen.readScreenshot()).toBeNull();
  });

  it("is refused again by a retry after the click ended, and offers it once more", async () => {
    const { platform, getDisplayMedia } = fakePlatform();
    const screen = createBrowserScreen(platform);
    expect(await screen.request({ capture: true })).toEqual(["capture", "fullscreen"]);
    await expect(getDisplayMedia.mock.results.at(-1)!.value).rejects.toThrow("No user activation");
    expect(browserScreenNextClick({ ...screen.get(), sound: "none" })?.action).toBe("resume");
  });

  it("takes a frame of its tab as a screenshot while it is shared", async () => {
    const { platform, click } = fakePlatform();
    const screen = createBrowserScreen(platform);
    expect(await screen.readScreenshot()).toBeNull();
    await click(() => screen.enroll());
    const frame = await screen.readScreenshot();
    expect(frame?.byteLength).toBe(30_000);
    expect(screenScreenshotFormat(new Uint8Array(frame!))).toBe("webp");
  });

  it("enrolls from the setup page's one button and goes on, ready again if going on fails", async () => {
    const enroll = vi.fn(async () => []);
    const onEnrolled = vi.fn(() => {
      throw new Error("Address refused");
    });
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<BrowserScreenEnroll browser={{ enroll }} onEnrolled={onEnrolled} />, host!));
    const button = host.querySelector("button")!;
    await act(async () => {
      button.click();
      await enroll.mock.results[0]!.value;
    });
    expect(enroll).toHaveBeenCalledTimes(1);
    expect(onEnrolled).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
  });

  it("writes the browser's marker with its ID, and keeps working where storage is refused", () => {
    expect(parseScreenPageAddress({ hash: `#${browserScreenAddress("K7M2QA")}` })).toEqual({
      screenId: "K7M2QA",
      host: "browser",
    });
    const blocked = screenStorage({
      get localStorage(): Storage {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    const id = browserScreenId(blocked);
    expect(screenIdSchema.safeParse(id).success).toBe(true);
    expect(browserScreenId(blocked)).toBe(id);
  });

  it("keeps its saved ID where the storage is full", () => {
    const persisted = memoryStorage();
    persisted.setItem(BROWSER_SCREEN_ID_KEY, "K7M2QA");
    const full = Object.assign(Object.create(persisted) as Storage, {
      setItem: () => {
        throw new DOMException("Full", "QuotaExceededError");
      },
    });
    const storage = screenStorage({ localStorage: full });
    expect(browserScreenId(storage)).toBe("K7M2QA");
    // This visit's writes still read back.
    storage.setItem("pkic.screen.cache", "kept");
    expect(storage.getItem("pkic.screen.cache")).toBe("kept");
    expect(persisted.getItem("pkic.screen.cache")).toBeNull();
  });
});

describe("the corner's next click", () => {
  const live = { fullscreen: true, wakeLock: true, capture: "live" as const };
  it.each([
    [{ ...live, sound: "on" as const }, null],
    [{ ...live, sound: "starting" as const }, null],
    [{ ...live, fullscreen: false, sound: "none" as const }, "fullscreen"],
    [{ ...live, capture: "off" as const, sound: "none" as const }, "share"],
    [{ ...live, sound: "blocked" as const }, "sound"],
    [{ ...live, fullscreen: false, sound: "blocked" as const }, "fullscreen"],
    [{ ...live, fullscreen: false, capture: "off" as const, sound: "none" as const }, "resume"],
    [{ ...live, fullscreen: false, capture: "stopped" as const, sound: "blocked" as const }, "resume"],
  ])("for %o is %s", (state, action) => {
    expect(browserScreenNextClick(state)?.action ?? null).toBe(action);
  });

  it("turns on sound within the click, with whatever else the click can do", async () => {
    const { platform, click } = fakePlatform({ pickerExitsFullscreen: true });
    const screen = createBrowserScreen(platform);
    await click(() => screen.enroll());
    const onSound = vi.fn();
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<BrowserScreenResume browser={screen} sound="blocked" onSound={onSound} />, host!));
    const action = host.querySelector<HTMLButtonElement>(".pk-screen-resume button")!;
    expect(action.textContent).toBe("Full screen");
    await act(async () => {
      click(() => action.click());
      await Promise.resolve();
    });
    expect(onSound).toHaveBeenCalledTimes(1);
    expect(screen.get().fullscreen).toBe(true);
  });

  it("reports sound only as the player confirms it", () => {
    expect(browserScreenSound(null)).toBe("none");
    expect(browserScreenSound({ status: "loading", muted: false })).toBe("starting");
    expect(browserScreenSound({ status: "playing", muted: false })).toBe("on");
    expect(browserScreenSound({ status: "playing", muted: true })).toBe("blocked");
  });
});

describe("keeping the laptop awake", () => {
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("holds the wake lock from the start, with no click", async () => {
    const { platform, requestWakeLock } = fakePlatform();
    const screen = createBrowserScreen(platform);
    await settle();
    expect(requestWakeLock).toHaveBeenCalledTimes(1);
    expect(screen.get().wakeLock).toBe(true);
    expect(screen.problems()).toEqual([]);
  });

  it("asks again once the page is visible after the browser let go while it was hidden", async () => {
    const { platform, requestWakeLock, setVisibility } = fakePlatform();
    const screen = createBrowserScreen(platform);
    await settle();
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BROWSER_SCREEN_WAKE_LOCK_RETRY_MS * 3);
    });
    // Hidden, there is nothing to ask: the browser would refuse.
    expect(screen.get().wakeLock).toBe(false);
    expect(requestWakeLock).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await settle();
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    expect(screen.get().wakeLock).toBe(true);
  });

  it("asks again shortly after the system lets go while the page is visible", async () => {
    const { platform, requestWakeLock, systemRelease } = fakePlatform();
    const screen = createBrowserScreen(platform);
    await settle();
    systemRelease();
    await settle();
    expect(screen.get().wakeLock).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BROWSER_SCREEN_WAKE_LOCK_RETRY_MS);
    });
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    expect(screen.get().wakeLock).toBe(true);
  });

  it("offers Keep awake only where the browser refused it without a click", async () => {
    const { platform, click, requestWakeLock } = fakePlatform({ wakeLock: "needs-click" });
    const screen = createBrowserScreen(platform);
    await settle();
    expect(screen.problems()).toEqual(["wake-lock"]);
    await click(() => screen.enroll());
    // The setup click asked for it too.
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    expect(screen.get()).toEqual({ fullscreen: false, wakeLock: true, capture: "live" });

    const refusing = fakePlatform({ wakeLock: "needs-click" });
    const refused = createBrowserScreen(refusing.platform);
    await settle();
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<BrowserScreenResume browser={refused} sound="none" />, host!));
    expect(host.querySelector(".pk-screen-resume__missing")?.textContent).toContain("May sleep");
    expect(host.querySelector(".pk-screen-resume button")?.textContent).toBe("Resume");
    await act(async () => {
      void refusing.click(() => refused.request({}));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refused.get().wakeLock).toBe(true);
    expect(refused.problems()).not.toContain("wake-lock");
  });

  it("needs no click where everything else is granted, unless the browser refused the lock", () => {
    const granted = { fullscreen: true, wakeLock: false, capture: "live" as const, sound: "on" as const };
    expect(browserScreenNextClick(granted)).toBeNull();
    expect(browserScreenNextClick(granted, { offerWakeLock: true })).toMatchObject({
      action: "awake",
      missing: ["May sleep"],
    });
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
    const webpFrame = await encodeBrowserScreenFrame(webp);
    expect(webpFrame?.byteLength).toBe(20_000);
    expect(screenScreenshotFormat(new Uint8Array(webpFrame!))).toBe("webp");
    expect(webp.asked).toEqual([["image/webp", BROWSER_SCREEN_FRAME.quality]]);

    // A browser without a WebP encoder answers with PNG.
    const jpeg = fakeCanvas([
      ["image/png", 90_000],
      ["image/jpeg", 25_000],
    ]);
    const jpegFrame = await encodeBrowserScreenFrame(jpeg);
    expect(jpegFrame?.byteLength).toBe(25_000);
    expect(screenScreenshotFormat(new Uint8Array(jpegFrame!))).toBe("jpeg");
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
  it("offers Resume at once on the pairing screen, which shares the tab again, then Full screen", async () => {
    vi.useFakeTimers();
    // A reload ends full screen and sharing: the page starts with neither.
    const { platform, click, getDisplayMedia, doc } = fakePlatform();
    const screen = createBrowserScreen(platform);
    const api = {
      read: vi.fn(async () => {
        throw new ApiClientError({ error: { code: "SCREEN_SESSION_MISSING", message: "Pair" } }, 401);
      }),
      startPairing: vi.fn(async () => ({ code: "HJKP4QRT", expiresAt: new Date(Date.now() + 600_000).toISOString() })),
      pollSession: vi.fn(async () => ({ status: "pending", expiresAt: new Date(Date.now() + 600_000).toISOString() })),
    } as unknown as ScreenApi;
    host = document.body.appendChild(document.createElement("div"));
    await act(() =>
      render(
        <ScreenApp
          screenId="K7M2QA"
          storage={localStorage}
          clock={createScreenClock()}
          api={api}
          onHandoff={vi.fn()}
          monitor={{ createSocket: fakeLiveSockets().factory }}
          browser={screen}
        />,
        host!,
      ),
    );
    for (const ms of [100, 100]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }
    expect(host.textContent).toContain("HJKP4QRT");
    const action = host.querySelector<HTMLButtonElement>(".pk-screen-resume button")!;
    expect(action.textContent).toBe("Resume");
    await act(async () => {
      click(() => action.click());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getDisplayMedia).toHaveBeenCalled();
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(screen.get()).toMatchObject({ fullscreen: false, capture: "live" });
    const fullscreen = host.querySelector<HTMLButtonElement>(".pk-screen-resume button")!;
    expect(fullscreen.textContent).toBe("Full screen");
    await act(async () => {
      click(() => fullscreen.click());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.get().fullscreen).toBe(true);
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
    expect(reports[0]?.health).toMatchObject({
      kind: "browser",
      browser: { capture: "off", fullscreen: false, sound: "none" },
    });
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
