import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("uses the event date and zone for live selection and honors continuing session durations", async () => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            timezone: "Asia/Kuala_Lumpur",
            agenda: {
              "2025-10-28": [
                {
                  time: "2:00",
                  startsAt: "2025-10-27T18:00:00.000Z",
                  endTime: "2:30",
                  sessions: [
                    { title: "Workshop", locations: ["red"], durationMinutes: 60 },
                    { title: "Short talk", locations: ["blue"], durationMinutes: 25 },
                  ],
                },
                {
                  time: "2:30",
                  endTime: "3:00",
                  sessions: [{ title: "Second talk", locations: ["blue"], durationMinutes: 25 }],
                },
              ],
            },
          }),
        ),
    ),
  );
  const display = await import("../../assets/js/event-common.js");
  await display.loadEventData("/events/synthetic/event-data.json");
  expect(display.resolveDayTime({ day: "now", time: "now" }, new Date("2025-10-27T18:40:00.000Z"))).toEqual({
    day: "2025-10-28",
    time: "02:40",
    autoUpdate: true,
  });
  expect(display.resolveDayTime({ time: "now" }, new Date("2025-10-27T18:40:00.000Z"))).toEqual({
    day: "2025-10-28",
    time: "02:40",
    autoUpdate: true,
  });
  expect(display.resolveDayTime({ day: "now", time: "now" }, new Date("2025-10-28T18:40:00.000Z"))).toEqual({
    day: "2025-10-29",
    time: "02:40",
    autoUpdate: true,
  });
  expect(display.getNextAgendaSlot({ day: "2025-10-29", time: "00:00" })).toBeNull();
  expect(display.getNextAgendaSlot({ day: "2025-10-27", time: "23:00" })).toEqual({ day: "2025-10-28", time: "2:00" });
  const continuing = display.getSessionsForTime({ day: "2025-10-28", time: "2:40", location: "red" });
  expect(continuing.map((session: { title: string }) => session.title)).toEqual(["Workshop"]);
  expect(continuing[0].startsAt).toBe("2025-10-27T18:00:00.000Z");
  expect(display.getSessionsForTime({ day: "2025-10-28", time: "2:27", location: "blue" })).toEqual([]);
  expect(display.getSessionsForTime({ day: "2025-10-28", time: "3:00", location: "red" })).toEqual([]);
});
