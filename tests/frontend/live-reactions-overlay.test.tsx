// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_REACTION_CROWD_POLICY } from "../../assets/shared/live-reaction-crowd";
import { LiveReactionsOverlay } from "../../assets/ts/live-session/LiveReactionsOverlay";
import type { LiveRoomState } from "../../assets/ts/live-session/live-room-state";

type Burst = NonNullable<LiveRoomState["burst"]>;
let host: HTMLElement;
let sequence = 0;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.useRealTimers();
});

function draw(burst: Omit<Burst, "sequence"> | null, showCount = true) {
  void act(() =>
    render(
      <LiveReactionsOverlay burst={burst && { ...burst, sequence: (sequence += 1) }} showCount={showCount} />,
      host,
    ),
  );
}
const floats = () => [...host.querySelectorAll(".pk-live-overlay__reaction")].map((node) => node.textContent);
const count = () => host.querySelector(".pk-live-overlay__reaction-count")?.textContent?.trim() ?? null;

describe("live reactions overlay", () => {
  it("floats one quiet reaction per person and never more than the lane holds", () => {
    draw({ counts: { applause: 1 }, people: { applause: 1 } });
    expect(floats()).toEqual(["👏"]);
    draw({ counts: { applause: 30, thumbs_up: 10 }, people: { applause: 31, thumbs_up: 10 } });
    expect(floats()).toHaveLength(LIVE_REACTION_CROWD_POLICY.maxFloating);
    // The newest stay; the lane reports how full it is so the stylesheet can fade it.
    expect(floats().at(-1)).toBe("👍");
    const lane = host.querySelector<HTMLElement>(".pk-live-overlay__reaction-lane")!;
    expect(lane.dataset.load).toBe("4");
  });

  it("clears every float once its rise ends, however many bursts follow", () => {
    draw({ counts: { applause: 1 }, people: { applause: 1 } });
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    draw({ counts: { love: 1 }, people: { applause: 1, love: 1 } });
    expect(floats()).toEqual(["👏", "❤️"]);
    void act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(floats()).toEqual([]);
  });

  it("adds nothing on air for a burst of repeat clicks", () => {
    draw({ counts: {}, people: { applause: 1 } });
    expect(floats()).toEqual([]);
  });

  it("shows a count from five people on one reaction and fades it after people stop", () => {
    draw({ counts: { applause: 4 }, people: { applause: 4 } });
    expect(count()).toBeNull();
    draw({ counts: { applause: 2, love: 1 }, people: { applause: 6, love: 1 } });
    expect(count()).toBe("👏 6");
    void act(() => {
      vi.advanceTimersByTime(LIVE_REACTION_CROWD_POLICY.countHoldSeconds * 1000 - 1000);
    });
    draw({ counts: { applause: 34 }, people: { applause: 40 } });
    expect(count()).toBe("👏 40");
    void act(() => {
      vi.advanceTimersByTime(LIVE_REACTION_CROWD_POLICY.countHoldSeconds * 1000);
    });
    expect(host.querySelector(".pk-live-overlay__reaction-total")?.hasAttribute("data-fading")).toBe(true);
    void act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(count()).toBeNull();
  });

  it("shows no count unless the composition asks for one", () => {
    draw({ counts: { applause: 40 }, people: { applause: 40 } }, false);
    expect(count()).toBeNull();
    expect(floats()).toHaveLength(LIVE_REACTION_CROWD_POLICY.maxFloating);
  });
});
