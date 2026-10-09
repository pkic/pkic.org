// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { SessionEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionEditor";
import {
  agendaSnapshotSchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
} from "../../assets/shared/schemas/event-agenda";
/** The WYSIWYG editor loads its engine lazily; the stub records how the session form configures it. */
const markdown = vi.hoisted(() => ({
  props: [] as Array<{ name: string; variant?: string; initialValue: string; onChange: (value: string) => void }>,
}));
vi.mock("../../assets/ts/components/markdown-editor/MarkdownInput", () => ({
  MarkdownEditor: (props: (typeof markdown.props)[number]) => {
    markdown.props.push(props);
    return <div data-markdown-editor={props.name} data-variant={props.variant} />;
  },
}));
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: null,
  rooms: [
    { id: "room", name: "Blue hall", capacity: 80 },
    { id: "overflow", name: "Overflow hall", capacity: 40 },
  ],
  occurrences: [
    {
      id: "session",
      title: "Cryptography workshop",
      description: "Session abstract",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      roomId: "room",
      speakers: [],
    },
  ],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
let host: HTMLElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});
async function mount(edit = false) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <SessionEditor
        snapshot={snapshot}
        occurrence={edit ? snapshot.occurrences[0] : undefined}
        onSaved={() => {}}
        onClose={() => {}}
      />,
      host,
    ),
  );
}
async function input(name: string, value: string) {
  const control = host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  await act(() => {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function locationBoxes() {
  return [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="additionalRoomIds"]')];
}
/** Ticks the wanted rooms before clearing the others, as an organizer moving a session does. */
async function selectLocations(ids: string[]) {
  const rooms = locationBoxes().filter((box) => box.value);
  for (const box of rooms.filter((item) => ids.includes(item.value) && !item.checked)) await act(() => box.click());
  for (const box of rooms.filter((item) => !ids.includes(item.value) && item.checked)) await act(() => box.click());
}
function tabLabels() {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map((tab) => tab.textContent);
}
function panelOf(name: string) {
  return host.querySelector(`[name="${name}"]`)!.closest('[role="tabpanel"]')!;
}
async function submit() {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await vi.waitFor(() => expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(false));
}
function capture() {
  const bodies: Array<{ method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push({ method: init.method ?? "GET", body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(snapshot), { headers: { "content-type": "application/json" } });
    }),
  );
  return bodies;
}
describe("agenda session request contracts", () => {
  it("keeps an unspecified presenter location following a single-room session move", async () => {
    const bodies = capture();
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(
        <SessionEditor
          snapshot={snapshot}
          occurrence={{
            ...snapshot.occurrences[0],
            speakers: [{ userId: "person", displayName: "Speaker", attendanceMode: "physical", roomId: null }],
          }}
          onSaved={() => {}}
          onClose={() => {}}
        />,
        host,
      ),
    );
    await selectLocations(["overflow"]);
    await submit();
    const body = agendaOccurrencePatchSchema.parse(bodies[0].body);
    expect(body.roomId).toBe("overflow");
    expect(body.speakerPlacements?.person).toEqual({ attendanceMode: "physical", roomId: null });
  });
  it("saves additional room reservations while preserving one canonical session", async () => {
    const bodies = capture();
    await mount(true);
    await selectLocations(["room", "overflow"]);
    await submit();
    const body = agendaOccurrencePatchSchema.parse(bodies[0].body);
    expect(body.roomId).toBe("room");
    expect(body.additionalRoomIds).toEqual(["overflow"]);
  });

  it("swaps primary and additional room roles without losing either reservation", async () => {
    const bodies = capture();
    await mount(true);
    await selectLocations(["overflow"]);
    await selectLocations(["overflow", "room"]);
    expect(
      locationBoxes()
        .filter((box) => box.checked)
        .map((box) => box.value),
    ).toEqual(["", "room", "overflow"]);
    await submit();
    expect(agendaOccurrencePatchSchema.parse(bodies[0].body)).toMatchObject({
      roomId: "overflow",
      additionalRoomIds: ["room"],
    });
  });
  it("creates an unscheduled session through the canonical create contract", async () => {
    const bodies = capture();
    await mount();
    expect(document.activeElement).toBe(host.querySelector("[name=title]"));
    await input("title", "New workshop");
    await submit();
    expect(bodies).toHaveLength(1);
    const body = agendaOccurrenceCreateSchema.parse(bodies[0].body);
    expect(body.startAt).toBeNull();
    expect(body.roomId).toBeNull();
    expect(body.expectedRevision).toBe(7);
  });
  it("converts an organizer wall clock to UTC before the guarded patch", async () => {
    const bodies = capture();
    await mount(true);
    await input("startAt", "2026-12-01T12:00");
    await input("endAt", "2026-12-01T12:30");
    await submit();
    const body = agendaOccurrencePatchSchema.parse(bodies[0].body);
    expect(bodies[0].method).toBe("PATCH");
    expect(body.startAt).toBe("2026-12-01T11:00:00.000Z");
    expect(body.endAt).toBe("2026-12-01T11:30:00.000Z");
  });
  it("rejects a nonexistent daylight-saving wall clock through the contract", async () => {
    const bodies = capture();
    await mount(true);
    await input("startAt", "2026-03-29T02:30");
    await submit();
    expect(bodies).toHaveLength(0);
    expect(host.querySelector('[aria-invalid="true"]')).not.toBeNull();
  });
});

it("moves an explicit primary-room speaker when the session editor changes location", async () => {
  const bodies = capture();
  const placed = {
    ...snapshot.occurrences[0],
    speakers: [
      {
        userId: "speaker",
        displayName: "Speaker",
        role: "panelist" as const,
        attendanceMode: "physical" as const,
        roomId: "room",
      },
    ],
  };
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(<SessionEditor snapshot={snapshot} occurrence={placed} onSaved={() => {}} onClose={() => {}} />, host),
  );
  await selectLocations(["overflow"]);
  await submit();
  const body = agendaOccurrencePatchSchema.parse(bodies[0].body);
  expect(body.roomId).toBe("overflow");
  expect(body.speakerPlacements).toEqual({ speaker: { attendanceMode: "physical", roomId: "overflow" } });
  expect(body.speakerRoles).toEqual({ speaker: "panelist" });
});

it("keeps saved speaker credits and placements through room changes; only the role is editable per speaker", async () => {
  const bodies = capture();
  const placed = {
    ...snapshot.occurrences[0],
    additionalRoomIds: ["overflow"],
    speakers: [
      {
        userId: "speaker",
        displayName: "Speaker",
        role: "panelist" as const,
        attendanceMode: "physical" as const,
        roomId: "room",
      },
      {
        userId: "remote",
        displayName: "Remote moderator",
        role: "moderator" as const,
        attendanceMode: "remote" as const,
      },
    ],
  };
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(<SessionEditor snapshot={snapshot} occurrence={placed} onSaved={() => {}} onClose={() => {}} />, host),
  );
  expect(host.querySelector('button[aria-label="Actions for Speaker"]')).toBeNull();
  expect(host.querySelector('button[aria-label="Remove speaker Speaker"]')).not.toBeNull();
  const rows = host.querySelector(".pk-agenda-editor__speakers")!;
  expect(
    rows.querySelectorAll(
      "input, textarea, select:not([aria-label^='Role for']), button:not([aria-label^='Remove speaker'])",
    ),
  ).toHaveLength(0);
  const roles = [...rows.querySelectorAll<HTMLSelectElement>("select[aria-label^='Role for']")];
  expect(roles.map((select) => [select.getAttribute("aria-label"), select.value])).toEqual([
    ["Role for Speaker", "panelist"],
    ["Role for Remote moderator", "moderator"],
  ]);
  expect([...roles[0]!.options].map((option) => [option.value, option.text])).toEqual([
    ["proposer", "Proposer"],
    ["speaker", "Speaker"],
    ["co_speaker", "Co-speaker"],
    ["moderator", "Moderator"],
    ["panelist", "Panelist"],
  ]);
  await submit();
  expect(agendaOccurrencePatchSchema.parse(bodies[0].body)).toMatchObject({
    speakerRoles: { speaker: "panelist", remote: "moderator" },
    speakerPlacements: {
      speaker: { attendanceMode: "physical", roomId: "room" },
      remote: { attendanceMode: "remote", roomId: null },
    },
  });
  await selectLocations(["overflow"]);
  await selectLocations(["overflow", "room"]);
  expect(locationBoxes()[0]!.checked).toBe(true);
  await submit();
  expect(agendaOccurrencePatchSchema.parse(bodies[1].body)).toMatchObject({
    roomId: "overflow",
    additionalRoomIds: ["room"],
    speakerRoles: { speaker: "panelist", remote: "moderator" },
    speakerPlacements: {
      speaker: { attendanceMode: "physical", roomId: "overflow" },
      remote: { attendanceMode: "remote", roomId: null },
    },
  });
});

it("saves a speaker's changed credit role without touching the attendance placement", async () => {
  const bodies = capture();
  const placed = {
    ...snapshot.occurrences[0],
    speakers: [
      {
        userId: "speaker",
        displayName: "Speaker",
        role: "speaker" as const,
        attendanceMode: "remote" as const,
      },
    ],
  };
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(<SessionEditor snapshot={snapshot} occurrence={placed} onSaved={() => {}} onClose={() => {}} />, host),
  );
  const role = host.querySelector<HTMLSelectElement>('select[aria-label="Role for Speaker"]')!;
  await act(() => {
    role.value = "co_speaker";
    role.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="Role for Speaker"]')!.value).toBe("co_speaker");
  await submit();
  expect(agendaOccurrencePatchSchema.parse(bodies[0].body)).toMatchObject({
    speakerUserIds: ["speaker"],
    speakerRoles: { speaker: "co_speaker" },
    speakerPlacements: { speaker: { attendanceMode: "remote", roomId: null } },
  });
});

it("submits and clears optional track metadata independently of location", async () => {
  const bodies = capture();
  await mount(true);
  await input("track", "  Cryptography  ");
  await submit();
  const saved = agendaOccurrencePatchSchema.parse(bodies[0].body);
  expect(saved.track).toBe("Cryptography");
  expect(saved.roomId).toBe("room");
  await input("track", "");
  await submit();
  expect(agendaOccurrencePatchSchema.parse(bodies[1].body).track).toBeNull();
});

describe("session editor structure", () => {
  it("leads with the session's identity and moves time and place to a Schedule tab", async () => {
    markdown.props.length = 0;
    await mount(true);
    expect(tabLabels()).toEqual(["Session", "Schedule", "Participation", "Media & equipment", "Publishing"]);
    const session = panelOf("title");
    for (const name of ["kind", "format", "track", "speakerUserIds"]) expect(panelOf(name), name).toBe(session);
    expect(session.querySelector(".pk-agenda-editor__form-row")!.querySelectorAll("select, input")).toHaveLength(3);
    expect(session.textContent).toContain("Type");
    expect(host.textContent).not.toContain("Agenda item");
    const schedule = panelOf("startAt");
    expect(schedule).not.toBe(session);
    expect(panelOf("endAt")).toBe(schedule);
    expect(schedule.querySelector('input[name="additionalRoomIds"]')).not.toBeNull();
    // Live demand is a statistic and slides are uploads: neither is edited here.
    expect(host.textContent).not.toContain("Current session demand");
    expect(host.querySelector('[name="presentationUrl"]')).toBeNull();
    expect(panelOf("recordingUrl")).toBe(panelOf("requiredEquipment"));
  });

  it("edits the Markdown description with the shared WYSIWYG editor at a taller size", async () => {
    const bodies = capture();
    markdown.props.length = 0;
    await mount(true);
    const editor = host.querySelector('[data-markdown-editor="description"]')!;
    expect(editor.getAttribute("data-variant")).toBe("compact");
    expect(editor.closest(".pk-agenda-editor__description")).not.toBeNull();
    expect(host.querySelector('textarea[name="description"]')).toBeNull();
    const latest = markdown.props[markdown.props.length - 1]!;
    expect(latest.initialValue).toBe("Session abstract");
    await act(() => latest.onChange("**Updated** abstract"));
    await submit();
    expect(agendaOccurrencePatchSchema.parse(bodies[0].body).description).toBe("**Updated** abstract");
  });
});

describe("event date bounds", () => {
  const bounded = agendaSnapshotSchema.parse({
    ...snapshot,
    eventStartsAt: "2026-12-01T08:00:00.000Z",
    eventEndsAt: "2026-12-02T17:00:00.000Z",
  });
  async function mountBounded(props: Partial<Parameters<typeof SessionEditor>[0]> = {}) {
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(<SessionEditor snapshot={bounded} onSaved={() => {}} onClose={() => {}} {...props} />, host),
    );
  }

  it("offers only the event's dates in the pickers and refuses an outside time before any request", async () => {
    const bodies = capture();
    await mountBounded({ occurrence: bounded.occurrences[0] });
    const start = host.querySelector<HTMLInputElement>('[name="startAt"]')!;
    expect(start.min).toBe("2026-12-01T09:00");
    expect(start.max).toBe("2026-12-02T18:00");
    expect(host.querySelector<HTMLInputElement>('[name="endAt"]')!.max).toBe("2026-12-02T18:00");
    await input("startAt", "2026-11-30T10:00");
    await input("endAt", "2026-11-30T11:00");
    await submit();
    expect(bodies).toHaveLength(0);
    const schedule = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith("Schedule"),
    )!;
    expect(schedule.getAttribute("aria-selected")).toBe("true");
    expect(start.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Start during the event's dates");
    await input("startAt", "2026-12-02T17:00");
    await input("endAt", "2026-12-02T19:00");
    await submit();
    expect(bodies).toHaveLength(0);
    expect(host.textContent).toContain("End during the event's dates");
    await input("endAt", "2026-12-02T18:00");
    await submit();
    expect(agendaOccurrencePatchSchema.parse(bodies[0].body)).toMatchObject({
      startAt: "2026-12-02T16:00:00.000Z",
      endAt: "2026-12-02T17:00:00.000Z",
    });
  });

  it("prefills a new session from the selected agenda window", async () => {
    const bodies = capture();
    await mountBounded({
      initialSchedule: { startAt: "2026-12-01T13:00:00.000Z", endAt: "2026-12-01T13:45:00.000Z", roomId: "overflow" },
    });
    expect(host.querySelector<HTMLInputElement>('[name="startAt"]')!.value).toBe("2026-12-01T14:00");
    expect(host.querySelector<HTMLInputElement>('[name="endAt"]')!.value).toBe("2026-12-01T14:45");
    await input("title", "Selected window");
    await submit();
    expect(agendaOccurrenceCreateSchema.parse(bodies[0].body)).toMatchObject({
      startAt: "2026-12-01T13:00:00.000Z",
      endAt: "2026-12-01T13:45:00.000Z",
      roomId: "overflow",
    });
  });
});

describe("planned media follow the location", () => {
  const roomLink = "https://meet.example.test/blue-hall";
  const equipped = agendaSnapshotSchema.parse({
    ...snapshot,
    rooms: [
      { id: "room", name: "Blue hall", capacity: 80, equipment: ["recording", "projector"], virtualRoomUrl: roomLink },
      { id: "overflow", name: "Overflow hall", capacity: 40 },
    ],
  });
  async function mountEquipped(occurrence = equipped.occurrences[0]) {
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(<SessionEditor snapshot={equipped} occurrence={occurrence} onSaved={() => {}} onClose={() => {}} />, host),
    );
  }
  function overrideBox() {
    return host.querySelector<HTMLInputElement>('input[name="plannedMedia"]')!;
  }

  it("shows the location defaults and keeps inheriting them unless overridden", async () => {
    const bodies = capture();
    await mountEquipped();
    expect(host.textContent).toContain(`Using location defaults from Blue hall: Recording · ${roomLink}`);
    expect(overrideBox().checked).toBe(false);
    expect(host.querySelector('[name="plannedMedia.recording"]')).toBeNull();
    expect(host.querySelector('[name="virtualRoomUrl"]')).toBeNull();
    await submit();
    expect(agendaOccurrencePatchSchema.parse(bodies[0].body)).toMatchObject({
      plannedMedia: null,
      virtualRoomUrl: null,
      requiredEquipment: [],
    });
  });

  it("overrides recording, live streaming and the link together for one session", async () => {
    const bodies = capture();
    await mountEquipped();
    await act(() => overrideBox().click());
    const recording = host.querySelector<HTMLInputElement>('[name="plannedMedia.recording"]')!;
    expect(recording.checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[name="virtualRoomUrl"]')!.value).toBe(roomLink);
    await act(() => recording.click());
    await act(() => host.querySelector<HTMLInputElement>('[name="plannedMedia.liveStreaming"]')!.click());
    await input("virtualRoomUrl", "");
    await submit();
    expect(agendaOccurrencePatchSchema.parse(bodies[0].body)).toMatchObject({
      plannedMedia: { recording: false, liveStreaming: true },
      virtualRoomUrl: null,
    });
    await act(() => overrideBox().click());
    await submit();
    expect(agendaOccurrencePatchSchema.parse(bodies[1].body)).toMatchObject({
      plannedMedia: null,
      virtualRoomUrl: null,
    });
  });

  it("opens an explicit session plan or own link as an override and keeps it", async () => {
    const bodies = capture();
    await mountEquipped({
      ...equipped.occurrences[0],
      plannedMedia: { recording: false, liveStreaming: false },
      virtualRoomUrl: "https://meet.example.test/own",
    });
    expect(overrideBox().checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[name="plannedMedia.recording"]')!.checked).toBe(false);
    await submit();
    expect(agendaOccurrencePatchSchema.parse(bodies[0].body)).toMatchObject({
      plannedMedia: { recording: false, liveStreaming: false },
      virtualRoomUrl: "https://meet.example.test/own",
    });
  });
});

describe("slides are managed in the session materials", () => {
  it("shows the current slides and opens the materials only when no edit would be lost", async () => {
    const manage = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(
        <SessionEditor
          snapshot={snapshot}
          occurrence={{ ...snapshot.occurrences[0], presentationUrl: "https://example.test/imported.pdf" }}
          onSaved={() => {}}
          onClose={() => {}}
          onManageSlides={manage}
        />,
        host,
      ),
    );
    expect(host.textContent).toContain("Imported link, no uploaded version");
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "Manage slides",
    )!;
    await act(() => button.click());
    expect(manage).toHaveBeenCalledWith(expect.objectContaining({ id: "session" }));
    await input("title", "Unsaved title");
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain("Save or cancel your changes before managing slides.");
  });
});
