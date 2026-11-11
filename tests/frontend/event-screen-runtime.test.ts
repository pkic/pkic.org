import { describe, expect, it } from "vitest";
import { screenOwnViewSchema, type ScreenOwnView } from "../../assets/shared/schemas/event-screens";
import { persistentRetryDelay } from "../../assets/ts/live-session/live-socket-retry";
import { screenAutoState } from "../../assets/ts/event-screens/screen-auto-mode";
import {
  cachedLiveSnapshot,
  cachedScreenView,
  mergeScreenAgenda,
  readScreenCache,
  screenAgendaRevision,
  screenCacheKey,
  writeScreenCache,
  SCREEN_CACHE_MAX_BYTES,
  type ScreenCache,
  type ScreenCachedAgenda,
} from "../../assets/ts/event-screens/screen-cache";
import { createScreenClock, screenClockOffset, screenClockSample } from "../../assets/ts/event-screens/screen-clock";
import { screenDisplay, type ScreenSituation } from "../../assets/ts/event-screens/screen-display";
import { screenHandoffDue, SCREEN_HANDOFF } from "../../assets/ts/event-screens/screen-handoff";
import {
  SCREEN_FIXTURE,
  SCREEN_FIXTURE_NOW,
  screenAgendaFixture,
  screenStageRunningFixture,
} from "../../assets/ts/ui/preview/event-screens-fixtures";

const MINUTE = 60_000;
const ROOM = SCREEN_FIXTURE.roomId;
const view = (assignment: ScreenOwnView["screen"]["assignment"]): ScreenOwnView =>
  screenOwnViewSchema.parse({
    viewer: "screen",
    screen: { id: "K7M2QA", name: "Stage left", assignment },
    serverNow: "2026-12-01T09:00:00.000Z",
    agenda: null,
    livestream: null,
    overlay: assignment ? { token: "signed", expiresAt: "2026-12-01T09:15:00.000Z" } : null,
  });
const assigned = view({
  eventSlug: "pqc-2026",
  roomId: ROOM,
  roomName: "Blue room",
  output: "stage-display",
  layout: null,
});
// The studio's session ends at 09:25; the fixed instant is 09:27:41.
const studioEnd = Date.parse(screenStageRunningFixture.session.endAt);

function situation(overrides: Partial<ScreenSituation>): ScreenSituation {
  return {
    now: studioEnd - 10 * MINUTE,
    pairingRequired: false,
    pairing: null,
    view: assigned,
    agenda: screenAgendaFixture,
    read: { connected: true, lastUpdateAt: studioEnd - 10 * MINUTE },
    live: { connected: true, lastUpdateAt: studioEnd - 10 * MINUTE, state: screenStageRunningFixture },
    ...overrides,
  };
}

describe("what a screen shows", () => {
  it("walks from pairing through waiting and showing to offline, auto mode and back", () => {
    const pairing = { code: "HJKP4QRT", expiresAt: "2026-12-01T09:10:00.000Z" };
    expect(screenDisplay(situation({ pairingRequired: true, pairing, view: null }))).toEqual({
      kind: "pairing",
      pairing,
    });
    expect(screenDisplay(situation({ view: view(null) }))).toMatchObject({ kind: "waiting", marker: null });

    const showing = screenDisplay(situation({}));
    expect(showing).toMatchObject({ kind: "output", output: "stage-display", marker: null });

    const droppedAt = studioEnd - 10 * MINUTE;
    const offline = (now: number) =>
      screenDisplay(
        situation({ now, live: { connected: false, lastUpdateAt: droppedAt, state: screenStageRunningFixture } }),
      );
    // The last state stays, first with a dot, then with the minutes since the server last answered.
    expect(offline(droppedAt + MINUTE)).toMatchObject({
      kind: "output",
      state: screenStageRunningFixture,
      marker: { kind: "offline-dot" },
    });
    expect(offline(droppedAt + 6 * MINUTE + 5_000)).toMatchObject({
      state: screenStageRunningFixture,
      marker: { kind: "offline-badge", minutes: 6 },
    });

    // Past the studio's session's end, still offline: the room's agenda takes over.
    const auto = offline(SCREEN_FIXTURE_NOW);
    expect(auto).toMatchObject({ kind: "output", output: "stage-display", marker: { kind: "auto" } });
    expect(auto.kind === "output" && auto.state.session.title).toBe(screenAgendaFixture.sessions[1]!.title);

    // Back online, the studio's state wins at once, even past its end.
    expect(
      screenDisplay(
        situation({
          now: SCREEN_FIXTURE_NOW,
          live: { connected: true, lastUpdateAt: SCREEN_FIXTURE_NOW, state: screenStageRunningFixture },
        }),
      ),
    ).toMatchObject({ kind: "output", state: screenStageRunningFixture, marker: null });
  });

  it("runs the agenda only on a stage display; other outputs hold their last frame", () => {
    const projector = view({ ...assigned.screen.assignment!, output: "projector", layout: "full-frame" });
    expect(
      screenDisplay(
        situation({
          now: SCREEN_FIXTURE_NOW,
          view: projector,
          live: { connected: false, lastUpdateAt: studioEnd - 10 * MINUTE, state: screenStageRunningFixture },
        }),
      ),
    ).toMatchObject({
      kind: "output",
      output: "projector",
      state: screenStageRunningFixture,
      marker: { kind: "offline-badge" },
    });
  });

  it("never switches on its own while connected, and needs an agenda to run alone", () => {
    const pastEnd = { now: SCREEN_FIXTURE_NOW };
    expect(screenDisplay(situation(pastEnd))).toMatchObject({ state: screenStageRunningFixture, marker: null });
    expect(
      screenDisplay(
        situation({
          ...pastEnd,
          agenda: null,
          live: { connected: false, lastUpdateAt: studioEnd, state: screenStageRunningFixture },
        }),
      ),
    ).toMatchObject({ state: screenStageRunningFixture, marker: { kind: "offline-badge" } });
  });

  it("shows the room waiting for the studio when nothing is selected", () => {
    expect(screenDisplay(situation({ live: { connected: true, lastUpdateAt: studioEnd, state: null } }))).toMatchObject(
      { kind: "idle", roomName: "Blue room", marker: null },
    );
  });

  it("counts down to the next start, then the session to its scheduled end", () => {
    const room = { id: ROOM, name: "Blue room" };
    const before = screenAutoState(screenAgendaFixture, room, SCREEN_FIXTURE_NOW)!;
    expect(before.timers[0]).toMatchObject({ kind: "until", running: true, anchorAt: "2026-12-01T09:30:00.000Z" });
    const during = screenAutoState(screenAgendaFixture, room, Date.parse("2026-12-01T09:40:00.000Z"))!;
    expect(during.timers[0]).toMatchObject({ kind: "session", anchorAt: "2026-12-01T10:15:00.000Z" });
    expect(during.outputs["stage-display"].schedule?.rooms[0]?.title).toBe(screenAgendaFixture.sessions[2]!.title);
    expect(screenAutoState(screenAgendaFixture, room, Date.parse("2026-12-01T23:00:00.000Z"))).toBeNull();
  });
});

describe("the screen's clock", () => {
  it("takes the offset of the shortest of the last eight round trips", () => {
    expect(screenClockSample(1_000, 1_200, new Date(5_100).toISOString())).toEqual({
      offsetMs: 4_000,
      roundTripMs: 200,
    });
    const samples = [
      { offsetMs: 900, roundTripMs: 20 },
      ...Array.from({ length: 7 }, (_, index) => ({ offsetMs: index, roundTripMs: 300 + index })),
      { offsetMs: 500, roundTripMs: 80 },
    ];
    // The 20 ms sample is the ninth from the end, so it no longer counts.
    expect(screenClockOffset(samples)).toBe(500);
    let device = 10_000;
    const clock = createScreenClock(() => device);
    clock.record(screenClockSample(10_000, 10_100, new Date(70_050).toISOString()));
    device = 20_000;
    expect(clock.now()).toBe(80_000);
  });
});

describe("the screen's copy on the device", () => {
  class MemoryStorage implements Storage {
    items = new Map<string, string>();
    quota = Infinity;
    get length() {
      return this.items.size;
    }
    clear() {
      this.items.clear();
    }
    getItem(key: string) {
      return this.items.get(key) ?? null;
    }
    key(index: number) {
      return [...this.items.keys()][index] ?? null;
    }
    removeItem(key: string) {
      this.items.delete(key);
    }
    setItem(key: string, value: string) {
      if (value.length > this.quota) throw new DOMException("Full", "QuotaExceededError");
      this.items.set(key, value);
    }
  }
  const cache = (live = true): ScreenCache => ({
    version: 1,
    savedAt: "2026-12-01T09:20:00.000Z",
    view: cachedScreenView(assigned),
    agenda: screenAgendaFixture,
    live: live ? cachedLiveSnapshot(screenStageRunningFixture) : null,
  });

  it("keeps no overlay access and reads back what it wrote", () => {
    const storage = new MemoryStorage();
    expect(writeScreenCache(storage, cache())).toBe(true);
    expect(storage.getItem(screenCacheKey("K7M2QA"))).not.toContain("signed");
    expect(readScreenCache(storage, "K7M2QA")).toEqual(cache());
  });

  it("forgets a copy that fails its contract or belongs to another screen", () => {
    const storage = new MemoryStorage();
    storage.setItem(screenCacheKey("K7M2QA"), JSON.stringify({ ...cache(), version: 2 }));
    expect(readScreenCache(storage, "K7M2QA")).toBeNull();
    expect(storage.getItem(screenCacheKey("K7M2QA"))).toBeNull();
    storage.setItem(screenCacheKey("ABC234"), JSON.stringify(cache()));
    expect(readScreenCache(storage, "ABC234")).toBeNull();
    storage.setItem(screenCacheKey("K7M2QA"), "{not json");
    expect(readScreenCache(storage, "K7M2QA")).toBeNull();
  });

  it("drops the live picture before giving up when the copy is too large", () => {
    const storage = new MemoryStorage();
    storage.quota = JSON.stringify(cache(false)).length;
    expect(writeScreenCache(storage, cache())).toBe(true);
    expect(readScreenCache(storage, "K7M2QA")?.live).toBeNull();
    const huge = {
      ...cache(false),
      view: { ...cache(false).view, screen: { ...assigned.screen, name: "x".repeat(SCREEN_CACHE_MAX_BYTES) } },
    };
    expect(writeScreenCache(new MemoryStorage(), huge)).toBe(false);
  });

  it("merges the agenda by revision and asks again before its window runs out", () => {
    const kept: ScreenCachedAgenda = screenAgendaFixture;
    const read = { ...kept, sessions: null };
    expect(mergeScreenAgenda(kept, read)).toEqual(kept);
    expect(mergeScreenAgenda(kept, { ...read, revision: 8 })).toBeNull();
    expect(mergeScreenAgenda(kept, null)).toBeNull();
    const to = Date.parse(kept.to);
    expect(screenAgendaRevision(kept, to - 25 * 3_600_000)).toBe(7);
    expect(screenAgendaRevision(kept, to - 23 * 3_600_000)).toBeNull();
  });
});

describe("handing the device back", () => {
  it("hands off only without a good state and after three minutes unreachable", () => {
    const since = 1_000_000;
    const late = since + SCREEN_HANDOFF.unreachableMs + 1;
    expect(screenHandoffDue({ hasGoodState: false, unreachableSince: since, now: late })).toBe(true);
    expect(screenHandoffDue({ hasGoodState: true, unreachableSince: since, now: late })).toBe(false);
    expect(screenHandoffDue({ hasGoodState: false, unreachableSince: since, now: late - 2 })).toBe(false);
    expect(screenHandoffDue({ hasGoodState: false, unreachableSince: null, now: late })).toBe(false);
  });

  it("retries a persistent connection with jittered backoff up to 30 seconds", () => {
    expect(persistentRetryDelay(0, () => 0)).toBe(500);
    expect(persistentRetryDelay(0, () => 1)).toBe(1_000);
    expect(persistentRetryDelay(20, () => 1)).toBe(30_000);
    expect(persistentRetryDelay(20, () => 0)).toBe(15_000);
  });
});
