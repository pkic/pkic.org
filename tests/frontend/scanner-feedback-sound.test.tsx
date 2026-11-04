import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScannerSound } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerSound";
import { scannerConnectionLabel } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerConnectionStatus";
import type { EventScanResponse } from "../../assets/shared/schemas/event-participation-scanning";

const host = document.createElement("div");
document.body.append(host);
const frequencies: number[] = [];
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
      stop: vi.fn(),
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
  offline = false,
}: {
  result?: EventScanResponse | null;
  enabled?: boolean;
  offline?: boolean;
}) {
  sound = useScannerSound(enabled, result, "attendance", false, offline);
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("audible scanner results", () => {
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
    expect(frequencies.slice(2)).toEqual([330, 220, 220]);
    await act(() => render(<Harness result={receipt("unverified")} />, host));
    expect(frequencies.slice(5)).toEqual([550, 550]);
    await act(() => render(null, host));
    expect(close).toHaveBeenCalledOnce();
  });
  it("distinguishes offline results and waits for a server receipt before sounding a correction", async () => {
    vi.stubGlobal("AudioContext", Audio);
    await act(() => render(<Harness offline />, host));
    await act(() => sound.unlock());
    const saved = receipt("eligible");
    await act(() => render(<Harness offline result={saved} />, host));
    expect(frequencies).toEqual([550, 550]);
    await act(() => render(<Harness result={saved} />, host));
    expect(frequencies).toEqual([550, 550]);
    await act(() => render(<Harness result={{ ...saved, recorded: true }} />, host));
    expect(frequencies.slice(2)).toEqual([880, 1174]);
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
  });
  it("separates disconnected saved scans from uploads and has no staff sync action", () => {
    expect(scannerConnectionLabel({ pending: 3, online: false, syncing: false })).toBe(
      "Offline · 3 saved on this device",
    );
    expect(scannerConnectionLabel({ pending: 3, online: true, syncing: true })).toBe("Uploading · 3 pending");
    expect(scannerConnectionLabel({ pending: 3, online: true, syncing: false })).toContain("retrying automatically");
  });
});
