// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { resolveUpcomingRooms } from "../../assets/shared/live-session-schedule";
import {
  liveScheduleCommandSchema,
  DEFAULT_LIVE_SCHEDULE_CONFIG,
  type LiveScheduleProjection,
} from "../../assets/shared/schemas/live-session-schedule";
import { liveRoomClientMessageSchema, type LiveRoomClientMessage } from "../../assets/shared/schemas/live-session-room";
import { applyLiveRoomMessage } from "../../assets/ts/live-session/live-room-state";
import { liveSnapshot, liveTargets } from "./helpers/live-room-socket";
import {
  LIVE_SCHEDULE_SPEAKER_TURN_MS,
  LIVE_SCHEDULE_SPOTLIGHT_MS,
  LiveScheduleOverlay,
  liveScheduleArrangement,
  liveScheduleFit,
  liveScheduleSpeakerLine,
} from "../../assets/ts/live-session/LiveScheduleOverlay";
import { LIVE_GRAPHIC_THEMES } from "../../assets/shared/live-graphic-theme";
import { LiveScheduleControls } from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveScheduleControls";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";
import { controlFor } from "./helpers/labeled-control";
let host: HTMLElement | undefined;
function roomState(program: LiveScheduleProjection) {
  const state = applyLiveRoomMessage(null, liveSnapshot());
  if (!state) throw new Error("Missing fixture");
  return { ...state, stage: { ...state.stage, schedule: program } };
}
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
});
function frame() {
  const snapshot = {
    ...approvedAgendaSnapshot,
    rooms: [
      { ...approvedAgendaSnapshot.rooms[0]!, id: "a", name: "Blue room" },
      { ...approvedAgendaSnapshot.rooms[0]!, id: "b", name: "Green room" },
    ],
    occurrences: [
      {
        ...approvedAgendaSnapshot.occurrences[0]!,
        id: "a",
        roomId: "a",
        title: "Post-quantum deployment",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
      },
      {
        ...approvedAgendaSnapshot.occurrences[0]!,
        id: "b",
        roomId: "b",
        title: "Certificate automation",
        startAt: "2026-12-01T09:30:00.000Z",
        endAt: "2026-12-01T10:30:00.000Z",
      },
    ],
  };
  return resolveUpcomingRooms(snapshot, null, Date.parse("2026-12-01T08:00:00.000Z"), DEFAULT_LIVE_SCHEDULE_CONFIG);
}
it.each(["cards", "list"] as const)(
  "renders exact room/session/time/approved names in the %s layout",
  async (layout) => {
    const schedule = frame();
    schedule.config.layout = layout;
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<LiveScheduleOverlay schedule={schedule} animate />, host!));
    // Two rooms read best as rows, whichever layout was chosen.
    expect(host.querySelector("[data-arrangement]")?.getAttribute("data-arrangement")).toBe("rows");
    expect(host.querySelectorAll(".pk-live-schedule__room")).toHaveLength(2);
    for (const name of [
      "Blue room",
      "Green room",
      "Post-quantum deployment",
      "Certificate automation",
      "Historical speaker",
      "(moderator)",
    ])
      expect(host.textContent).toContain(name);
    expect(host.textContent).toContain("10:00");
    expect(host.textContent).toContain("10:30");
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe("2026-12-01T09:00:00.000Z");
    expect(host.textContent).not.toContain("Current profile name");
  },
);
it.each(LIVE_GRAPHIC_THEMES)("draws Up next in the %s theme, with the same content", async (theme) => {
  const schedule = busyFrame();
  schedule.config = { ...schedule.config, theme };
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveScheduleOverlay schedule={schedule} animate />, host!));
  const graphic = host.querySelector<HTMLElement>(".pk-live-schedule")!;
  expect(graphic.dataset.graphicTheme).toBe(theme);
  expect(host.querySelector("h2")?.textContent).toBe("Up next");
  expect([...host.querySelectorAll(".pk-live-schedule__room-name")].map((room) => room.textContent)).toEqual([
    "Room 0",
    "Room 1",
    "Room 2",
    "Room 3",
  ]);
});
it("sets itself for the box it is drawn into: cards for one wide row of rooms, rows otherwise", async () => {
  expect([liveScheduleFit({ width: 1536 }), liveScheduleFit({ width: 960 }), liveScheduleFit({ width: 560 })]).toEqual([
    "wide",
    "medium",
    "narrow",
  ]);
  expect(liveScheduleArrangement("cards", "wide", 3)).toBe("cards");
  expect(liveScheduleArrangement("cards", "wide", 2)).toBe("rows");
  expect(liveScheduleArrangement("cards", "wide", 5)).toBe("rows");
  expect(liveScheduleArrangement("cards", "narrow", 6)).toBe("rows");
  expect(liveScheduleArrangement("list", "wide", 6)).toBe("rows");
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveScheduleOverlay schedule={busyFrame()} box={{ width: 560 }} animate />, host!));
  expect(host.querySelector<HTMLElement>(".pk-live-schedule")!.dataset).toMatchObject({
    fit: "narrow",
    arrangement: "rows",
  });
});
it("shows each speaker's public headshot", async () => {
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveScheduleOverlay schedule={frame()} animate />, host!));
  const portraits = [...host.querySelectorAll<HTMLImageElement>(".pk-live-schedule__face img")];
  expect(portraits.map((image) => image.getAttribute("src"))).toEqual(["/approved-photo.jpg", "/approved-photo.jpg"]);
});
it("resolves each speaker's organization, and no stream room without a selected room", () => {
  const snapshot = frame();
  expect(snapshot.streamRoomId).toBeNull();
  expect(snapshot.rooms[0]!.speakers.map((speaker) => speaker.organization)).toContain("Historical organization");
});
it("leads with this room, by name, and sets the other rooms apart under their own label", async () => {
  const base = frame();
  const schedule = { ...base, streamRoomId: base.rooms[1]!.roomId };
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveScheduleOverlay schedule={schedule} animate />, host!));
  const names = [...host.querySelectorAll(".pk-live-schedule__room-name")].map((room) => room.textContent);
  expect(names).toEqual([`This room (${base.rooms[1]!.roomName})`, base.rooms[0]!.roomName]);
  const items = [...host.querySelectorAll(".pk-live-schedule__rooms > li")].map((item) => item.className);
  expect(items).toEqual(["pk-live-schedule__room", "pk-live-schedule__split", "pk-live-schedule__room"]);
  expect(host.querySelector(".pk-live-schedule__split")!.textContent).toBe("In other rooms");
});
it("leaves this room unnamed when it is the only room", async () => {
  const base = frame();
  const schedule = { ...base, rooms: [base.rooms[0]!], streamRoomId: base.rooms[0]!.roomId };
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveScheduleOverlay schedule={schedule} animate />, host!));
  expect(host.querySelector(".pk-live-schedule__room-name")).toBeNull();
  expect(host.querySelector(".pk-live-schedule__split")).toBeNull();
});
const speaker = (name: string, moderator = false, organization: string | null = null) => ({
  name,
  moderator,
  photoUrl: null,
  organization,
});
it("names up to two speakers under the title on one line", async () => {
  expect(liveScheduleSpeakerLine([speaker("Pat Panelist")])).toBe("Pat Panelist");
  expect(liveScheduleSpeakerLine([speaker("Ana Example"), speaker("Fay Moderator", true)])).toBe(
    "Ana Example, Fay Moderator (moderator)",
  );
  const schedule = frame();
  schedule.rooms = [{ ...schedule.rooms[0]!, speakers: [speaker("Ana Example"), speaker("Fay Moderator", true)] }];
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveScheduleOverlay schedule={schedule} animate />, host!));
  const room = host.querySelector(".pk-live-schedule__room")!;
  expect(room.querySelector(".pk-live-schedule__title + .pk-live-schedule__speakers")).not.toBeNull();
  expect(room.querySelector(".pk-live-schedule__names")?.textContent).toBe("Ana Example, Fay Moderator (moderator)");
  expect(room.querySelector("[data-turning]")).toBeNull();
});
it("names a larger panel one speaker at a time, with their organization, even without motion", async () => {
  vi.useFakeTimers();
  try {
    const panel = ["A", "B", "C", "D", "E"].map((initial) => speaker(`${initial} Example`, false, `${initial} Org`));
    panel.push(speaker("F Example", true, "F Org"));
    const schedule = frame();
    schedule.rooms = [{ ...schedule.rooms[0]!, speakers: panel }];
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<LiveScheduleOverlay schedule={schedule} animate={false} />, host!));
    const room = host.querySelector(".pk-live-schedule__room")!;
    expect(room.querySelectorAll(".pk-live-schedule__face")).toHaveLength(6);
    expect(room.querySelector(".pk-live-schedule__more")).toBeNull();
    expect(room.querySelector(".pk-live-schedule__names")).toBeNull();
    const named = () => [
      room.querySelector(".pk-live-schedule__turn[data-active]")?.textContent,
      [...room.querySelectorAll(".pk-live-schedule__face")].findIndex((face) => face.hasAttribute("data-active")),
    ];
    expect(named()).toEqual(["A ExampleA Org", 0]);
    for (let turn = 1; turn < 6; turn++)
      await act(() => {
        vi.advanceTimersByTime(LIVE_SCHEDULE_SPEAKER_TURN_MS);
      });
    expect(named()).toEqual(["F ExampleModerator · F Org", 5]);
    await act(() => {
      vi.advanceTimersByTime(LIVE_SCHEDULE_SPEAKER_TURN_MS);
    });
    expect(named()).toEqual(["A ExampleA Org", 0]);
  } finally {
    vi.useRealTimers();
  }
});
/** Four rooms in the next block: enough for the graphic to bring one card forward at a time. */
function busyFrame() {
  const schedule = frame();
  const [first] = schedule.rooms;
  schedule.rooms = [0, 1, 2, 3].map((index) => ({
    ...first!,
    roomId: `r${index}`,
    roomName: `Room ${index}`,
    roomIndex: index,
  }));
  return schedule;
}
const activeRoom = () =>
  host!.querySelector(".pk-live-schedule__room[data-active] .pk-live-schedule__room-name")?.textContent;
it("brings one card forward at a time when several rooms are next", async () => {
  vi.useFakeTimers();
  try {
    host = document.body.appendChild(document.createElement("div"));
    await act(() => render(<LiveScheduleOverlay schedule={busyFrame()} animate />, host!));
    expect(host.querySelector("[data-spotlight]")).not.toBeNull();
    expect(activeRoom()).toBe("Room 0");
    await act(() => {
      vi.advanceTimersByTime(LIVE_SCHEDULE_SPOTLIGHT_MS);
    });
    expect(activeRoom()).toBe("Room 1");
    expect(host.querySelectorAll(".pk-live-schedule__room[data-active]")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
it("keeps every card still where the graphic may not move", async () => {
  host = document.body.appendChild(document.createElement("div"));
  await act(() => render(<LiveScheduleOverlay schedule={busyFrame()} animate={false} />, host!));
  expect(host.querySelector("[data-spotlight]")).toBeNull();
  expect(host.querySelector(".pk-live-schedule__room[data-active]")).toBeNull();
  expect(host.querySelectorAll(".pk-live-schedule__room")).toHaveLength(4);
});
it("silently removes missing/empty schedule graphics rather than broadcasting diagnostic copy", async () => {
  host = document.body.appendChild(document.createElement("div"));
  for (const schedule of [
    null,
    { ...frame(), available: false, timeZone: null, rooms: [] },
    { ...frame(), rooms: [] },
  ]) {
    await act(() => render(<LiveScheduleOverlay schedule={schedule} animate />, host!));
    expect(host.textContent).toBe("");
  }
});
it("sends independent config-only Preview/Program commands and does not clear an inactive program", async () => {
  const program = frame(),
    sendProgram = vi.fn<(message: LiveRoomClientMessage) => boolean>(() => true);
  host = document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(
      <LiveScheduleControls
        detail="Next session"
        targets={liveTargets(roomState(program), { programActive: false, sendProgram })}
      />,
      host!,
    ),
  );
  await act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Show up next in preview"]')!.click());
  expect(liveRoomClientMessageSchema.parse(sendProgram.mock.calls[0]![0])).toEqual({
    type: "preview.set",
    composition: { schedule: DEFAULT_LIVE_SCHEDULE_CONFIG },
  });
  expect(sendProgram).toHaveBeenCalledTimes(1);
  await act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Up next actions"]')!.click());
  await act(() =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes("Up next settings"))!
      .click(),
  );
  expect(document.querySelector('select[name="scope"]')).toBeNull();
  const layout = controlFor<HTMLSelectElement>(document, "Layout");
  await act(() => {
    layout.value = "list";
    layout.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const colors = controlFor<HTMLSelectElement>(document, "Colors");
  expect([...colors.options].map((option) => option.textContent)).toEqual([
    "Event colors",
    "White on transparent",
    "White on black",
    "Black on transparent",
    "Black on white",
  ]);
  await act(() => {
    colors.value = "black-on-white";
    colors.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Save",
  )!;
  await act(() => save.click());
  await act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Show up next on air"]')!.click());
  expect(liveScheduleCommandSchema.parse(sendProgram.mock.calls[1]![0])).toEqual({
    type: "stage.schedule",
    schedule: { scope: "all-rooms", layout: "list", theme: "black-on-white" },
  });
  expect(program.config).toEqual(DEFAULT_LIVE_SCHEDULE_CONFIG);
});
