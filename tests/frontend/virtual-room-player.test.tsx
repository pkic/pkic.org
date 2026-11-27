// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualRoomPlayer } from "../../assets/ts/member-flows/portal/sections/events/app/virtual-room/VirtualRoomPlayer";
import type { YouTubePlayerEvents } from "../../assets/ts/event-screens/youtube-iframe-api";

interface FakePlayer {
  events: YouTubePlayerEvents;
  playVideo: ReturnType<typeof vi.fn>;
  pauseVideo: ReturnType<typeof vi.fn>;
  tracks: unknown;
}

let players: FakePlayer[] = [];
let host: HTMLElement;
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const ready = () => act(() => players[0]!.events.onReady?.({ target: players[0] as never }));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  players = [];
  Object.assign(window, {
    YT: {
      loaded: 1,
      Player: class {
        playVideo = vi.fn();
        pauseVideo = vi.fn();
        mute = vi.fn();
        unMute = vi.fn();
        setVolume = vi.fn();
        destroy = vi.fn();
        isMuted = vi.fn(() => true);
        getPlayerState = vi.fn(() => -1);
        loadModule = vi.fn();
        unloadModule = vi.fn();
        tracks: unknown = undefined;
        getOption = vi.fn(() => this.tracks);
        constructor(_frame: HTMLIFrameElement, options: { events: YouTubePlayerEvents }) {
          players.push(Object.assign(this, { events: options.events }) as unknown as FakePlayer);
        }
      },
    },
  });
  host = document.body.appendChild(document.createElement("div"));
  await act(async () => {
    render(
      <VirtualRoomPlayer
        stream={{ provider: "youtube", videoId: "abcdefghijk" }}
        locationName="Main hall"
        sound={false}
        onSound={() => undefined}
      />,
      host,
    );
    await vi.advanceTimersByTimeAsync(0);
  });
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "YT");
});

describe("the virtual room player", () => {
  it("keeps a stream paused before the player was ready paused once it is", async () => {
    await act(async () => button("Pause").click());
    await ready();
    expect(players[0]!.pauseVideo).toHaveBeenCalled();
    expect(players[0]!.playVideo).not.toHaveBeenCalled();
    expect(button("Play")).not.toBeNull();
  });

  it("says a stream has no captions once a player that was still starting can tell", async () => {
    await act(async () => button("Captions").click());
    // The player cannot tell yet for a while, however long it takes to start, then finds no caption track.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(button("Captions").getAttribute("aria-pressed")).toBe("true");
    await ready();
    players[0]!.tracks = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(button("Captions").getAttribute("aria-pressed")).toBe("false");
    expect(host.textContent).toContain("This stream has no captions");
  });
});
