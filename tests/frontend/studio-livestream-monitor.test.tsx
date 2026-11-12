// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVESTREAM_AT_LIVE_EDGE,
  LIVESTREAM_LIVE_EDGE_POLICY,
  nextLivestreamLiveEdge,
  type LivestreamLiveEdge,
  type LivestreamLiveEdgeReading,
} from "../../assets/ts/event-screens/livestream-live-edge";
import { YOUTUBE_PLAYER_STATES, type YouTubePlayerEvents } from "../../assets/ts/event-screens/youtube-iframe-api";
import { StudioLivestreamMonitor } from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/StudioLivestreamMonitor";
import {
  STUDIO_LIVESTREAM_SOUND_STORAGE_KEY,
  loadStudioLivestreamSound,
  setStudioLivestreamSound,
  studioLivestreamAudible,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/studio/studio-livestream-sound";

const { behindSeconds, sustainMs, cooldownMs, maxSeeks, windowMs } = LIVESTREAM_LIVE_EDGE_POLICY;

/** Readings one second apart from `from`, each `lag` seconds behind live while playing; returns the seek times. */
function play(lag: number, seconds: number, from = 0, start: LivestreamLiveEdge = LIVESTREAM_AT_LIVE_EDGE) {
  let edge = start;
  const seeks: number[] = [];
  for (let second = 0; second <= seconds; second += 1) {
    const reading: LivestreamLiveEdgeReading = { lagSeconds: lag, playing: true, at: from + second * 1000 };
    const next = nextLivestreamLiveEdge(edge, reading);
    edge = next.edge;
    if (next.seek) seeks.push(reading.at);
  }
  return { edge, seeks };
}

describe("keeping the LIVE monitor at the live edge", () => {
  it("never seeks while the player plays at the edge, or while it is not playing live", () => {
    expect(play(behindSeconds, 600).seeks).toEqual([]);
    let edge = LIVESTREAM_AT_LIVE_EDGE;
    for (let at = 0; at < 60_000; at += 1000) {
      for (const reading of [
        { lagSeconds: 120, playing: false, at },
        { lagSeconds: null, playing: true, at },
      ]) {
        const next = nextLivestreamLiveEdge(edge, reading);
        expect(next.seek).toBe(false);
        edge = next.edge;
      }
    }
  });

  it("seeks once the player has stayed behind for a moment, and not on a passing dip", () => {
    expect(play(behindSeconds + 5, sustainMs / 1000 - 1).seeks).toEqual([]);
    expect(play(behindSeconds + 5, sustainMs / 1000).seeks).toEqual([sustainMs]);
    // Back at the edge in between starts the wait again.
    const dipped = play(behindSeconds + 5, 1);
    const recovered = nextLivestreamLiveEdge(dipped.edge, { lagSeconds: 2, playing: true, at: 2000 });
    expect(play(behindSeconds + 5, sustainMs / 1000 - 1, 3000, recovered.edge).seeks).toEqual([]);
  });

  it("waits between seeks and gives up for a while when the stream keeps falling behind", () => {
    const { seeks } = play(behindSeconds + 20, windowMs / 1000 - 1);
    expect(seeks).toHaveLength(maxSeeks);
    for (const [index, at] of seeks.entries())
      if (index > 0) expect(at - seeks[index - 1]!).toBeGreaterThanOrEqual(cooldownMs);
    // Once the first seek leaves the window, it may try again.
    const later = play(behindSeconds + 20, windowMs / 1000 + 10).seeks;
    expect(later).toHaveLength(maxSeeks + 1);
    expect(later[maxSeeks]! - later[0]!).toBeGreaterThanOrEqual(windowMs);
  });
});

interface FakePlayer {
  frame: HTMLIFrameElement;
  events: YouTubePlayerEvents;
  playVideo: ReturnType<typeof vi.fn>;
  mute: ReturnType<typeof vi.fn>;
  unMute: ReturnType<typeof vi.fn>;
  seekTo: ReturnType<typeof vi.fn>;
}

describe("the studio LIVE monitor", () => {
  let players: FakePlayer[] = [];
  let host: HTMLElement | undefined;
  let lag = 0;
  const live = 3_600;
  const latest = () => players.at(-1)!;
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const ready = () => act(() => latest().events.onReady?.({ target: latest() as never }));
  const playing = () =>
    act(() => latest().events.onStateChange?.({ data: YOUTUBE_PLAYER_STATES.playing, target: latest() as never }));

  async function mount() {
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<StudioLivestreamMonitor videoId="first-video" roomName="Blue room" />, host!));
    await advance(10);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setStudioLivestreamSound(false);
    players = [];
    lag = 0;
    Object.assign(window, {
      YT: {
        loaded: 1,
        Player: class {
          destroy = vi.fn();
          playVideo = vi.fn();
          mute = vi.fn();
          unMute = vi.fn();
          setVolume = vi.fn();
          seekTo = vi.fn();
          getVideoData = () => ({ isLive: true });
          getDuration = () => live;
          getCurrentTime = () => live - lag;
          constructor(frame: HTMLIFrameElement, options: { events: YouTubePlayerEvents }) {
            players.push(Object.assign(this, { frame, events: options.events }) as unknown as FakePlayer);
          }
        },
      },
    });
  });
  afterEach(async () => {
    if (host) {
      await act(() => render(null, host!));
      host.remove();
      host = undefined;
    }
    vi.useRealTimers();
    Reflect.deleteProperty(window, "YT");
  });

  it("starts by itself, muted, without anyone pressing play", async () => {
    await mount();
    const src = new URL(latest().frame.src);
    expect(Object.fromEntries(src.searchParams)).toMatchObject({ autoplay: "1", mute: "1", controls: "0" });
    await ready();
    expect(latest().mute).toHaveBeenCalled();
    expect(latest().playVideo).toHaveBeenCalled();
    expect(latest().unMute).not.toHaveBeenCalled();
    expect(studioLivestreamAudible()).toBe(false);
  });

  it("turns the sound on and off on the running player, and keeps the choice in this browser", async () => {
    await mount();
    await ready();
    await playing();
    await act(() => setStudioLivestreamSound(true));
    expect(latest().unMute).toHaveBeenCalledTimes(1);
    expect(players).toHaveLength(1);
    expect(localStorage.getItem(STUDIO_LIVESTREAM_SOUND_STORAGE_KEY)).toBe("on");
    expect(loadStudioLivestreamSound(localStorage)).toBe(true);
    expect(studioLivestreamAudible()).toBe(true);
    await act(() => setStudioLivestreamSound(false));
    expect(latest().mute).toHaveBeenCalledTimes(2);
    expect(loadStudioLivestreamSound(localStorage)).toBe(false);
  });

  it("returns to the live edge when it falls behind, without seeking again and again", async () => {
    await mount();
    await ready();
    await playing();
    await advance(30_000);
    expect(latest().seekTo).not.toHaveBeenCalled();
    lag = behindSeconds + 20;
    await advance(sustainMs + 1_000);
    expect(latest().seekTo).toHaveBeenCalledTimes(1);
    expect(latest().seekTo).toHaveBeenCalledWith(live, true);
    // Still behind right after: it waits for the seek to settle.
    await advance(cooldownMs - 2_000);
    expect(latest().seekTo).toHaveBeenCalledTimes(1);
  });
});
