import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error Legacy event display code is still plain JavaScript.
import * as eventCommon from "../../assets/js/event-common.js";

const {
  activateNumericShortcut,
  createIncrementalSearchBuffer,
  getSessionSpeakerGroups,
  getSessionsForTime,
  handleSearchOrNumericShortcut,
  initializeEventDisplay,
  loadEventData,
  shortcutIndexForKey,
} = eventCommon;

const eventData = {
  agenda: {
    Monday: [
      {
        time: "10:00",
        endTime: "11:00",
        sessions: [
          { title: "Room A session", locations: ["Room A"], speakers: ["Ada Lovelace"] },
          { title: "Room B session", locations: ["Room B"], speakers: ["Grace Hopper"] },
        ],
      },
    ],
  },
  speakers: [
    { name: "Ada Lovelace", title: "Engineer" },
    { name: "Grace Hopper", title: "Admiral" },
  ],
  locations: ["Room A", "Room B"],
};

describe("event agenda collection helpers", () => {
  beforeAll(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(eventData), { headers: { "content-type": "application/json" } })),
    );
    await loadEventData("/event-data.json");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the same day, time, and location window to sessions and speaker groups", async () => {
    const query = { day: "Monday", time: "10:30", location: "Room A" };

    expect(getSessionsForTime(query).map((session: { title: string }) => session.title)).toEqual(["Room A session"]);
    expect(
      getSessionSpeakerGroups(query).map(
        (group: { session: { title: string }; speakers: Array<{ name: string }> }) => ({
          session: group.session.title,
          speakers: group.speakers.map((speaker) => speaker.name),
        }),
      ),
    ).toEqual([{ session: "Room A session", speakers: ["Ada Lovelace"] }]);
  });

  it("shares incremental-search reset behavior across event displays", () => {
    vi.useFakeTimers();
    const search = createIncrementalSearchBuffer(250);

    expect(search.append("p")).toBe("p");
    expect(search.append("k")).toBe("pk");
    vi.advanceTimersByTime(249);
    expect(search.value).toBe("pk");
    vi.advanceTimersByTime(1);
    expect(search.value).toBe("");
  });

  it("maps the shared numeric keyboard shortcuts", () => {
    expect(shortcutIndexForKey("1")).toBe(0);
    expect(shortcutIndexForKey("9")).toBe(8);
    expect(shortcutIndexForKey("0")).toBe(9);
    expect(shortcutIndexForKey("x")).toBeNull();
  });

  it("activates only in-range numeric shortcuts", () => {
    const select = vi.fn();
    expect(activateNumericShortcut("2", ["first", "second"], select)).toBe(true);
    expect(select).toHaveBeenCalledWith(1);
    expect(activateNumericShortcut("0", ["first", "second"], select)).toBe(false);
    expect(activateNumericShortcut("x", ["first", "second"], select)).toBe(false);
  });

  it("routes letter searches and numeric selections through one keyboard policy", () => {
    const onSearch = vi.fn();
    const onBeforeSelect = vi.fn();
    const onSelect = vi.fn();
    const options = { onSearch, items: ["one"], onBeforeSelect, onSelect };

    expect(handleSearchOrNumericShortcut({ key: "a" }, options)).toBe(true);
    expect(onSearch).toHaveBeenCalledWith("a");
    expect(handleSearchOrNumericShortcut({ key: "1" }, options)).toBe(true);
    expect(onBeforeSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(0);
    expect(handleSearchOrNumericShortcut({ key: "+" }, options)).toBe(false);
  });

  it("installs and disposes the common event-display lifecycle", async () => {
    vi.useFakeTimers();
    const update = vi.fn();
    const onKeyDown = vi.fn();
    let autoUpdate = true;

    const dispose = await initializeEventDisplay({
      update,
      onKeyDown,
      isAutoUpdateEnabled: () => autoUpdate,
      intervalMs: 100,
    });
    expect(update).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
    vi.advanceTimersByTime(100);
    expect(update).toHaveBeenCalledTimes(3);
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    autoUpdate = false;
    vi.advanceTimersByTime(100);
    expect(update).toHaveBeenCalledTimes(3);
    dispose();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(update).toHaveBeenCalledTimes(3);
  });
});
