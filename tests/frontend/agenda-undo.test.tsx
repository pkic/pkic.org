// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { agendaSnapshotSchema, agendaOccurrencePatchSchema } from "../../assets/shared/schemas/event-agenda";
import { runRowAction } from "./helpers/row-actions";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Blue hall", capacity: 80 }],
  occurrences: [
    {
      id: "session",
      title: "Original workshop",
      description: "",
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
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function edit() {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<AgendaEditor slug="synthetic" canEdit />, host));
  await settle();
  await runRowAction(host, "Original workshop", "Edit / move session");
  await act(() => {
    const input = host.querySelector<HTMLInputElement>('[name="title"]')!;
    input.value = "Updated workshop";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await settle();
}
describe("revision guarded session undo", () => {
  it("sends the inverse patch at the returned revision", async () => {
    const bodies: unknown[] = [];
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "PATCH") {
          bodies.push(JSON.parse(String(init.body)));
          writes++;
          return json(
            writes === 1
              ? { ...snapshot, revision: 8, occurrences: [{ ...snapshot.occurrences[0], title: "Updated workshop" }] }
              : { ...snapshot, revision: 9 },
          );
        }
        return json(snapshot);
      }),
    );
    await edit();
    const undo = [...host.querySelectorAll("button")].find((value) => value.textContent === "Undo last session edit")!;
    await act(async () => {
      undo.click();
      await Promise.resolve();
    });
    const body = agendaOccurrencePatchSchema.parse(bodies[1]);
    expect(body.expectedRevision).toBe(8);
    expect(body.title).toBe("Original workshop");
  });
  it("refreshes after a concurrent edit prevents undo", async () => {
    let writes = 0;
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "PATCH") {
          writes++;
          return writes === 1
            ? json({
                ...snapshot,
                revision: 8,
                occurrences: [{ ...snapshot.occurrences[0], title: "Updated workshop" }],
              })
            : json({ error: { code: "CONFLICT", message: "Another organizer changed the agenda." } }, 409);
        }
        reads++;
        return json(
          reads === 1
            ? snapshot
            : {
                ...snapshot,
                revision: 9,
                occurrences: [{ ...snapshot.occurrences[0], title: "Another organizer's session" }],
              },
        );
      }),
    );
    await edit();
    const undo = [...host.querySelectorAll("button")].find((value) => value.textContent === "Undo last session edit")!;
    await act(async () => {
      undo.click();
      await Promise.resolve();
    });
    await settle();
    expect(reads).toBe(2);
    expect(host.textContent).toContain("Another organizer's session");
    expect(host.textContent).toContain("Another organizer changed the agenda.");
    expect(host.textContent).not.toContain("Undo last session edit");
  });
});
