import { usePrintScannerSound } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/usePrintScannerSound";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScannerSound } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerSound";
import { scannerConnectionLabel } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerConnectionStatus";
import type { EventScanResponse } from "../../assets/shared/schemas/event-participation-scanning";

const host = document.createElement("div");
document.body.append(host);
const frequencies: number[] = [];
const stops: number[] = [];
const close = vi.fn(async () => {});
class Audio {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  close = close;
  createOscillator() {
    return {
      frequency: {
        set value(value: number) {
          frequencies.push(value);
        },
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: (time: number) => stops.push(time),
      onended: null,
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
}
let sound: ReturnType<typeof useScannerSound>;
function Harness({
  result = null,
  enabled = true,
  action = "attendance",
  session = false,
}: {
  result?: EventScanResponse | null;
  enabled?: boolean;
  action?: "attendance" | "checkout" | "lead";
  session?: boolean;
}) {
  sound = useScannerSound(enabled, result, action, false, session);
  return null;
}
const receipt = (outcome: EventScanResponse["outcome"], operationId = crypto.randomUUID()): EventScanResponse => ({
  operationId,
  outcome,
  reason: outcome === "eligible" ? "eligible" : "verification_required",
  recorded: false,
  attendanceRecorded: false,
});
afterEach(async () => {
  await act(() => render(null, host));
  frequencies.length = 0;
  stops.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("audible scanner results", () => {
  it("previews warning and error sounds from explicit tour controls even when live feedback is muted", async () => {
    vi.stubGlobal("AudioContext", Audio);
    await act(() => render(<Harness enabled={false} />, host));
    await act(async () => sound.test("warning"));
    expect(frequencies).toEqual([440, 440]);
    frequencies.length = 0;
    await act(async () => sound.test("error"));
    expect(frequencies.length).toBeGreaterThan(0);
    expect(frequencies).not.toEqual([440, 440]);
    frequencies.length = 0;
    await act(() => render(<Harness enabled={false} result={receipt("eligible")} />, host));
    expect(frequencies).toEqual([]);
  });
  it("plays distinct short tones, deduplicates an acknowledgment and closes audio on unmount", async () => {
    vi.stubGlobal("AudioContext", Audio);
    await act(() => render(<Harness />, host));
    await act(() => sound.unlock());
    const success = receipt("eligible");
    await act(() => render(<Harness result={success} />, host));
    expect(frequencies).toEqual([880, 1174]);
    await act(() => render(<Harness result={{ ...success, recorded: true, attendanceRecorded: true }} />, host));
    expect(frequencies).toHaveLength(2);
    await act(() => render(<Harness result={receipt("warning")} />, host));
    expect(frequencies.slice(2)).toEqual([440, 440]);
    await act(() => render(<Harness result={receipt("unverified")} />, host));
    expect(frequencies.slice(4)).toEqual([550, 550]);
    await act(() => render(null, host));
    expect(close).toHaveBeenCalledOnce();
  });
  it("plays success for a locally verified badge without repeating it on upload acknowledgment", async () => {
    vi.stubGlobal("AudioContext", Audio);
    await act(() => render(<Harness />, host));
    await act(() => sound.unlock());
    const saved = receipt("eligible");
    await act(() => render(<Harness result={saved} />, host));
    expect(frequencies).toEqual([880, 1174]);
    await act(() => render(<Harness result={saved} />, host));
    expect(frequencies).toEqual([880, 1174]);
    await act(() => render(<Harness result={{ ...saved, recorded: true }} />, host));
    expect(frequencies).toEqual([880, 1174]);
  });
  it("stays silent when muted and tolerates unavailable audio", async () => {
    vi.stubGlobal("AudioContext", Audio);
    await act(() => render(<Harness enabled={false} />, host));
    await act(() => sound.unlock());
    await act(() => render(<Harness enabled={false} result={receipt("eligible")} />, host));
    expect(frequencies).toEqual([]);
    await act(() => render(null, host));
    vi.stubGlobal("AudioContext", undefined);
    await act(() => render(<Harness />, host));
    await act(() => sound.unlock());
    expect(sound.available).toBe(false);
  });
});
describe("visible synchronization status", () => {
  it("never claims synchronization before reading the durable queue or during a failure", () => {
    expect(scannerConnectionLabel({ pending: 0, online: true, syncing: false, ready: false })).toBe(
      "Checking saved scans…",
    );
    expect(scannerConnectionLabel({ pending: 0, online: true, syncing: false, error: "Sign in again" })).toBe(
      "Sign in again",
    );
    expect(scannerConnectionLabel({ pending: 0, online: true, syncing: false })).toBe("All scans synced");
    expect(scannerConnectionLabel({ pending: 0, online: true, syncing: true })).toBe("Checking uploads…");
  });
  it("separates disconnected saved scans from uploads and has no staff sync action", () => {
    expect(scannerConnectionLabel({ pending: 3, online: false, syncing: false })).toBe(
      "Offline · 3 saved on this device",
    );
    expect(scannerConnectionLabel({ pending: 3, online: true, syncing: true })).toBe("Uploading · 3 pending");
    expect(scannerConnectionLabel({ pending: 3, online: true, syncing: false })).toContain("retrying automatically");
  });
});

it("uses distinct success sounds for entry, exit, session and leads", async () => {
  vi.stubGlobal("AudioContext", Audio);
  const heard: string[] = [];
  for (const mode of [
    { action: "attendance" as const },
    { action: "checkout" as const },
    { action: "attendance" as const, session: true },
    { action: "lead" as const },
  ]) {
    await act(() => render(<Harness {...mode} />, host));
    await act(() => sound.unlock());
    frequencies.length = 0;
    await act(() => render(<Harness {...mode} result={receipt("eligible")} />, host));
    heard.push(frequencies.join(","));
  }
  expect(new Set(heard).size).toBe(4);
});
it("uses longer warnings and errors, optional vibration, and silence when muted", async () => {
  const vibrate = vi.fn();
  vi.stubGlobal("navigator", Object.create(navigator, { vibrate: { value: vibrate } }));
  vi.stubGlobal("AudioContext", Audio);
  await act(() => render(<Harness />, host));
  await act(() => sound.unlock());
  await act(() => render(<Harness result={receipt("eligible")} />, host));
  const successDuration = Math.max(...stops);
  stops.length = 0;
  await act(() => render(<Harness result={receipt("warning")} />, host));
  const warningDuration = Math.max(...stops);
  expect(warningDuration).toBeGreaterThan(successDuration);
  expect(vibrate).toHaveBeenCalledOnce();
  stops.length = 0;
  await act(() => render(<Harness result={receipt("denied")} />, host));
  expect(Math.max(...stops)).toBeGreaterThan(warningDuration);
  expect(vibrate).toHaveBeenCalledTimes(2);
  frequencies.length = 0;
  await act(() => render(<Harness enabled={false} result={receipt("denied")} />, host));
  expect(frequencies).toHaveLength(0);
  expect(vibrate).toHaveBeenCalledTimes(2);
});

it("sounds a prepared print job once, not while loading or after a failed job", async () => {
  vi.stubGlobal("AudioContext", Audio);
  let printSound!: ReturnType<typeof usePrintScannerSound>;
  function Print({ job, busy = false, error = "" }: { job?: string; busy?: boolean; error?: string }) {
    printSound = usePrintScannerSound(job, busy, error);
    return null;
  }
  await act(() => render(<Print />, host));
  await act(() => printSound.unlock());
  await act(() => render(<Print job="first" busy />, host));
  expect(frequencies).toHaveLength(0);
  await act(() => render(<Print job="first" />, host));
  const printed = [...frequencies];
  expect(printed).toEqual([523, 659, 784]);
  await act(() => render(<Print job="first" />, host));
  expect(frequencies).toEqual(printed);
  frequencies.length = 0;
  await act(() => render(<Print job="second" error="Could not prepare the label" />, host));
  expect(frequencies).not.toEqual(printed);
  expect(stops.at(-1)).toBeGreaterThan(0.8);
});
