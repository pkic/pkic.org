// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screenReadResponseSchema } from "../../assets/shared/schemas/event-screens";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import {
  LIVESTREAM_HEALTH_POLICY,
  nextLivestreamHealth,
  startLivestreamHealth,
  type LivestreamHealth,
  type LivestreamHealthEvent,
} from "../../assets/ts/event-screens/livestream-health";
import { livestreamPlayerReport, readLivestreamPlayback } from "../../assets/ts/event-screens/livestream-player-report";
import type { ScreenApi } from "../../assets/ts/event-screens/screen-api";
import { ScreenApp } from "../../assets/ts/event-screens/ScreenApp";
import { createScreenClock } from "../../assets/ts/event-screens/screen-clock";
import { YOUTUBE_PLAYER_STATES, type YouTubePlayerEvents } from "../../assets/ts/event-screens/youtube-iframe-api";

const run = (events: LivestreamHealthEvent[], from = startLivestreamHealth("first-video", 0)) =>
  events.reduce<LivestreamHealth>(nextLivestreamHealth, from);

describe("a livestream screen's player health", () => {
  it("shows the card on an error, recreates the player with backoff, and recovers when it plays", () => {
    const failed = run([
      { type: "state", state: "playing", at: 1_000 },
      { type: "fault", at: 2_000 },
    ]);
    expect(failed).toMatchObject({ status: "error", reconnecting: true, generation: 0 });
    expect(run([{ type: "tick", at: 2_000 + LIVESTREAM_HEALTH_POLICY.retryFirstMs - 1 }], failed).generation).toBe(0);
    const retrying = run([{ type: "tick", at: 2_000 + LIVESTREAM_HEALTH_POLICY.retryFirstMs }], failed);
    expect(retrying).toMatchObject({ status: "loading", reconnecting: true, generation: 1 });
    // A second fault waits twice as long.
    const again = run([{ type: "fault", at: 10_000 }], retrying);
    expect(again.retryAt).toBe(10_000 + 2 * LIVESTREAM_HEALTH_POLICY.retryFirstMs);
    const recovered = run(
      [
        { type: "tick", at: again.retryAt! },
        { type: "state", state: "playing", at: again.retryAt! + 3_000 },
      ],
      again,
    );
    expect(recovered).toMatchObject({ status: "playing", reconnecting: false, faults: 0, generation: 2 });
  });

  it("treats the end of the stream as a fault", () => {
    expect(run([{ type: "state", state: "ended", at: 5 }])).toMatchObject({ status: "error", reconnecting: true });
  });

  it("gives buffering a minute before it counts as a fault", () => {
    const buffering = run([
      { type: "state", state: "playing", at: 0 },
      { type: "state", state: "buffering", at: 1_000 },
    ]);
    expect(buffering).toMatchObject({ status: "buffering", reconnecting: false });
    expect(run([{ type: "tick", at: 1_000 + LIVESTREAM_HEALTH_POLICY.stallMs - 1 }], buffering).reconnecting).toBe(
      false,
    );
    expect(run([{ type: "tick", at: 1_000 + LIVESTREAM_HEALTH_POLICY.stallMs }], buffering)).toMatchObject({
      status: "error",
      reconnecting: true,
    });
    // Playing again in time clears the stall.
    const resumed = run([{ type: "state", state: "playing", at: 30_000 }], buffering);
    expect(run([{ type: "tick", at: 500_000 }], resumed)).toBe(resumed);
  });

  it("never recreates a player that plays the same video, and starts afresh for another", () => {
    const playing = run([{ type: "state", state: "playing", at: 0 }]);
    expect(run([{ type: "video", videoId: "first-video", at: 10 }], playing)).toBe(playing);
    expect(run([{ type: "tick", at: 3_600_000 }], playing)).toBe(playing);
    const switched = run([{ type: "video", videoId: "next-video1", at: 20 }], playing);
    expect(switched).toMatchObject({ videoId: "next-video1", status: "loading", generation: 1, reconnecting: false });
  });
});

describe("the livestream screen", () => {
  const SCREEN = "K7M2QA";
  const assignment = {
    eventSlug: "pqc-2026",
    roomId: "11111111-1111-4111-8111-111111111111",
    roomName: "Blue room",
    output: "livestream",
    layout: null,
  } as const;
  const ownView = (videoId: string) =>
    screenReadResponseSchema.parse({
      viewer: "screen",
      screen: { id: SCREEN, name: "Foyer", assignment },
      serverNow: new Date().toISOString(),
      agenda: null,
      livestream: { provider: "youtube", videoId },
      overlay: { token: "signed", expiresAt: new Date(Date.now() + 900_000).toISOString() },
    });
  const timed = (response: ReturnType<typeof ownView>) => ({ response, sentAt: Date.now(), receivedAt: Date.now() });
  const unreachable = () => new ApiClientError({ error: { code: "NETWORK_UNAVAILABLE", message: "Down" } }, 0);

  interface FakePlayer {
    frame: HTMLIFrameElement;
    events: YouTubePlayerEvents;
    destroy: ReturnType<typeof vi.fn>;
    playVideo: ReturnType<typeof vi.fn>;
    mute: ReturnType<typeof vi.fn>;
  }
  let players: FakePlayer[] = [];
  let host: HTMLElement | undefined;

  function fakeApi() {
    return {
      read: vi.fn<ScreenApi["read"]>(),
      startPairing: vi.fn<ScreenApi["startPairing"]>(),
      pollSession: vi.fn<ScreenApi["pollSession"]>(),
    };
  }
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  async function mountApp(api: ReturnType<typeof fakeApi>) {
    host = document.body.appendChild(document.createElement("div"));
    await act(() =>
      render(
        <ScreenApp
          screenId={SCREEN}
          storage={localStorage}
          clock={createScreenClock()}
          api={api}
          onHandoff={vi.fn()}
        />,
        host!,
      ),
    );
    await advance(100);
  }
  const latest = () => players.at(-1)!;
  const emit = (state: keyof typeof YOUTUBE_PLAYER_STATES) =>
    act(() => latest().events.onStateChange?.({ data: YOUTUBE_PLAYER_STATES[state], target: latest() as never }));
  const reconnecting = () => host!.querySelector(".pk-screen-livestream__reconnecting [role=status]") !== null;
  const videoOf = (player: FakePlayer) => new URL(player.frame.src).pathname;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    players = [];
    Object.assign(window, {
      YT: {
        loaded: 1,
        Player: class {
          destroy = vi.fn();
          playVideo = vi.fn();
          mute = vi.fn();
          unMute = vi.fn();
          setVolume = vi.fn();
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

  it("plays the day's stream on YouTube's privacy-enhanced player, sandboxed and without controls", async () => {
    const api = fakeApi();
    api.read.mockResolvedValue(timed(ownView("first-video")));
    await mountApp(api);
    expect(players).toHaveLength(1);
    const src = new URL(latest().frame.src);
    expect(src.origin).toBe("https://www.youtube-nocookie.com");
    expect(src.pathname).toBe("/embed/first-video");
    expect(Object.fromEntries(src.searchParams)).toMatchObject({
      autoplay: "1",
      playsinline: "1",
      controls: "0",
      rel: "0",
      enablejsapi: "1",
    });
    expect(latest().frame.getAttribute("sandbox")).not.toMatch(/allow-popups|allow-top-navigation/u);
    await emit("playing");
    expect(livestreamPlayerReport()).toMatchObject({ status: "playing", videoId: "first-video" });
  });

  it("keeps playing while the site is down, and switches only when the day's stream changes", async () => {
    const api = fakeApi();
    api.read.mockResolvedValue(timed(ownView("first-video")));
    await mountApp(api);
    await emit("playing");
    const playing = latest();

    api.read.mockRejectedValue(unreachable());
    await advance(10 * 60_000);
    expect(players).toEqual([playing]);
    expect(playing.destroy).not.toHaveBeenCalled();
    expect(reconnecting()).toBe(false);

    api.read.mockResolvedValue(timed(ownView("first-video")));
    await advance(60_000);
    expect(players).toEqual([playing]);

    api.read.mockResolvedValue(timed(ownView("next-video1")));
    await advance(60_000);
    expect(playing.destroy).toHaveBeenCalled();
    expect(players).toHaveLength(2);
    expect(videoOf(latest())).toBe("/embed/next-video1");
  });

  it("covers a failed player with the reconnecting card until a new player plays", async () => {
    const api = fakeApi();
    api.read.mockResolvedValue(timed(ownView("first-video")));
    await mountApp(api);
    await emit("playing");
    await act(() => latest().events.onError?.({ data: 150, target: latest() as never }));
    expect(reconnecting()).toBe(true);
    expect(livestreamPlayerReport()).toMatchObject({ status: "error", videoId: "first-video" });

    await advance(LIVESTREAM_HEALTH_POLICY.retryFirstMs + 1_000);
    expect(players).toHaveLength(2);
    expect(players[0]!.destroy).toHaveBeenCalled();
    expect(reconnecting()).toBe(true);
    await emit("playing");
    expect(reconnecting()).toBe(false);
    // The health report reads the error and the stall through the new player, until another video.
    expect(readLivestreamPlayback()).toMatchObject({
      errorCode: 150,
      stalls: { lastMinute: { count: 1, seconds: (LIVESTREAM_HEALTH_POLICY.retryFirstMs + 1_000) / 1000 }, started: 1 },
    });
  });

  it("starts muted when the browser refuses to start with sound, instead of reconnecting", async () => {
    const api = fakeApi();
    api.read.mockResolvedValue(timed(ownView("first-video")));
    await mountApp(api);
    await act(() => latest().events.onReady?.({ target: latest() as never }));
    await emit("unstarted");
    await advance(5_000);
    expect(latest().mute).toHaveBeenCalled();
    await emit("playing");
    expect(reconnecting()).toBe(false);
    expect(players).toHaveLength(1);
    expect(livestreamPlayerReport()).toMatchObject({ status: "playing", muted: true });
  });

  it("stays with sound when the player starts in time", async () => {
    const api = fakeApi();
    api.read.mockResolvedValue(timed(ownView("first-video")));
    await mountApp(api);
    await act(() => latest().events.onReady?.({ target: latest() as never }));
    await emit("playing");
    await advance(10_000);
    expect(latest().mute).not.toHaveBeenCalled();
    expect(livestreamPlayerReport()).toMatchObject({ status: "playing", muted: false });
  });

  it("starts the last known stream after a restart while the site is down", async () => {
    const api = fakeApi();
    api.read.mockResolvedValue(timed(ownView("first-video")));
    await mountApp(api);
    await act(() => render(null, host!));
    players = [];

    api.read.mockRejectedValue(unreachable());
    await act(() =>
      render(
        <ScreenApp
          screenId={SCREEN}
          storage={localStorage}
          clock={createScreenClock()}
          api={api}
          onHandoff={vi.fn()}
        />,
        host!,
      ),
    );
    await advance(100);
    expect(players).toHaveLength(1);
    expect(videoOf(latest())).toBe("/embed/first-video");
  });
});
