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
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Blue hall", capacity: 80 }],
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
async function submit() {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
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
