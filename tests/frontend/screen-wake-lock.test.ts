// @vitest-environment jsdom
/** The one screen wake lock the event scanner and browser screens both hold. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { scannerImmersiveLifecycle } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/immersive-scanner";
import { screenWakeLock } from "../../assets/ts/shared/screen-wake-lock";

vi.mock("../../assets/ts/shared/screen-wake-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../assets/ts/shared/screen-wake-lock")>();
  return { ...actual, screenWakeLock: vi.fn(actual.screenWakeLock) };
});

function fakeLock() {
  const lock = Object.assign(new EventTarget(), {
    released: false,
    release: vi.fn(async () => {
      lock.released = true;
      lock.dispatchEvent(new Event("release"));
    }),
  });
  return lock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the screen wake lock", () => {
  it("is the one the scanner holds", () => {
    vi.stubGlobal("navigator", { wakeLock: { request: async () => fakeLock() } });
    const awake = vi.fn();
    scannerImmersiveLifecycle(document.createElement("div"), () => {}, awake)();
    expect(screenWakeLock).toHaveBeenCalledWith(awake);
  });

  it("asks once at a time and says when the browser lets go", async () => {
    const lock = fakeLock();
    const request = vi.fn(async () => lock);
    const awake = vi.fn();
    const onReleased = vi.fn();
    const held = screenWakeLock(awake, { wakeLock: () => ({ request }), onReleased });
    const [first, second] = [held.acquire(), held.acquire()];
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await held.acquire()).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    await lock.release();
    expect(awake).toHaveBeenLastCalledWith(false);
    expect(onReleased).toHaveBeenCalledTimes(1);
  });

  it("lets a lock go that arrives after it was given up", async () => {
    const lock = fakeLock();
    const awake = vi.fn();
    const held = screenWakeLock(awake, { wakeLock: () => ({ request: async () => lock }) });
    const asked = held.acquire();
    held.dispose();
    expect(await asked).toBe(false);
    expect(lock.release).toHaveBeenCalled();
    expect(awake).not.toHaveBeenCalledWith(true);
  });

  it("goes on without one where the browser has none or refuses", async () => {
    const awake = vi.fn();
    expect(await screenWakeLock(awake, { wakeLock: () => undefined }).acquire()).toBe(false);
    const refusing = { request: async () => Promise.reject(new DOMException("Refused", "NotAllowedError")) };
    expect(await screenWakeLock(awake, { wakeLock: () => refusing }).acquire()).toBe(false);
    expect(awake).not.toHaveBeenCalledWith(true);
  });
});
