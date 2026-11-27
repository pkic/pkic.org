// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_OVERLAY_PRESET_LAYOUTS } from "../../assets/shared/live-overlay-layout-presets";
import type { LiveOverlayLayoutElements } from "../../assets/shared/schemas/live-overlay-layout";
import { useLiveSpotTurns } from "../../assets/ts/live-session/useLiveSpotTurns";

function Clock({ elements, also }: { elements: LiveOverlayLayoutElements; also?: LiveOverlayLayoutElements }) {
  return <output>{useLiveSpotTurns(elements, ...(also ? [also] : []))}</output>;
}

const host = document.createElement("div");
const shown = () => Number(host.textContent);

afterEach(() => {
  render(null, host);
  vi.useRealTimers();
});

describe("the clock a scene's spots take turns by", () => {
  it("reads the time again when the scene starts taking turns, and as each turn starts", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await act(() => render(<Clock elements={LIVE_OVERLAY_PRESET_LAYOUTS.default.elements} />, host));
    expect(shown()).toBe(1_000_000);
    // Without a spot that takes turns, the clock never wakes.
    await act(() => void vi.advanceTimersByTime(120_000));
    expect(shown()).toBe(1_000_000);
    await act(() => render(<Clock elements={LIVE_OVERLAY_PRESET_LAYOUTS.break.elements} />, host));
    expect(shown()).toBe(1_120_000);
    await act(() => void vi.advanceTimersByTime(15_000));
    expect(Math.floor(shown() / 15_000)).toBe(Math.floor(1_135_000 / 15_000));
  });

  it("wakes for Preview's turns while Program's scene takes none", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const program = LIVE_OVERLAY_PRESET_LAYOUTS.default.elements;
    await act(() => render(<Clock elements={program} also={LIVE_OVERLAY_PRESET_LAYOUTS.break.elements} />, host));
    await act(() => void vi.advanceTimersByTime(15_000));
    expect(Math.floor(shown() / 15_000)).toBe(Math.floor(1_015_000 / 15_000));
  });
});
