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
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionDemand", () => ({
  SessionDemand: () => null,
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
  blocks: [],
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
async function selectLocations(ids: string[]) {
  const control = host.querySelector<HTMLSelectElement>('[name="additionalRoomIds"]')!;
  expect(control.multiple).toBe(true);
  await act(() => {
    for (const option of control.options) option.selected = ids.includes(option.value);
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function optionalDetails() {
  await act(() => {
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === "Optional / settings")!
      .click();
  });
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
    const presenter = host.querySelector<HTMLSelectElement>('[aria-label="Location for Speaker"]')!;
    expect(presenter.value).toBe("");
    expect(presenter.selectedOptions[0].textContent).toBe("Follow session location");
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
    const chosen = host.querySelector<HTMLSelectElement>('[name="additionalRoomIds"]')!;
    expect([...chosen.selectedOptions].map((option) => option.value)).toEqual([""]);
    expect(host.textContent).toContain("All locations");
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
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Location for Speaker"]')!.value).toBe("overflow");
  await submit();
  const body = agendaOccurrencePatchSchema.parse(bodies[0].body);
  expect(body.roomId).toBe("overflow");
  expect(body.speakerPlacements).toEqual({ speaker: { attendanceMode: "physical", roomId: "overflow" } });
  expect(body.speakerRoles).toEqual({ speaker: "panelist" });
});

it("honors an explicit speaker placement after promoting the overflow room", async () => {
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
    ],
  };
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(<SessionEditor snapshot={snapshot} occurrence={placed} onSaved={() => {}} onClose={() => {}} />, host),
  );
  await selectLocations(["overflow"]);
  const speaker = host.querySelector<HTMLSelectElement>('[aria-label="Location for Speaker"]')!;
  expect(speaker.value).toBe("overflow");
  await selectLocations(["overflow", "room"]);
  expect(host.textContent).toContain("All locations");
  await act(() => {
    speaker.value = "room";
    speaker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(speaker.value).toBe("room");
  await submit();
  const body = agendaOccurrencePatchSchema.parse(bodies[0].body);
  expect(body).toMatchObject({
    roomId: "overflow",
    additionalRoomIds: ["room"],
    speakerRoles: { speaker: "panelist" },
    speakerPlacements: { speaker: { attendanceMode: "physical", roomId: "room" } },
  });
});

it("submits and clears optional track metadata independently of location", async () => {
  const bodies = capture();
  await mount(true);
  await optionalDetails();
  await input("track", "  Cryptography  ");
  await submit();
  const saved = agendaOccurrencePatchSchema.parse(bodies[0].body);
  expect(saved.track).toBe("Cryptography");
  expect(saved.roomId).toBe("room");
  await input("track", "");
  await submit();
  expect(agendaOccurrencePatchSchema.parse(bodies[1].body).track).toBeNull();
});
