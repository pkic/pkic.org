// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/RoomEditor";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: null,
  rooms: [
    {
      id: "room",
      name: "Hall",
      capacity: 80,
      equipment: ["projector"],
      availablePeriods: [{ startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T11:00:00.000Z" }],
    },
  ],
  occurrences: [],
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
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(<RoomEditor snapshot={snapshot} room={snapshot.rooms[0]} onSaved={() => {}} onClose={() => {}} />, host),
  );
}
async function input(name: string, value: string) {
  const control = host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  await act(() => {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("Location editing", () => {
  it("edits an existing location with equipment and timezone-correct opening periods", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ ...snapshot, revision: 8 }), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(host.querySelector<HTMLInputElement>('[name="availablePeriods.0.startAt"]')!.value).toBe("2026-12-01T10:00");
    await input("name", "Main hall");
    await input("equipment", "Projector, Microphones");
    await input("availablePeriods.0.endAt", "2026-12-01T13:00");
    await save();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/events/synthetic/agenda/rooms/room");
    expect(request.method).toBe("PUT");
    expect(JSON.parse(request.body as string)).toMatchObject({
      expectedRevision: 7,
      name: "Main hall",
      equipment: ["projector", "microphones"],
      availablePeriods: [{ startAt: "2026-12-01T09:00:00.000Z", endAt: "2026-12-01T12:00:00.000Z" }],
    });
  });
  it("refuses reversed opening periods before sending an update", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await mount();
    await input("availablePeriods.0.endAt", "2026-12-01T09:00");
    await save();
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Closing time must follow opening time");
  });
});
