// @vitest-environment jsdom
import { render } from "preact";
import { render as html } from "preact-render-to-string";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agendaOccurrenceListItemSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { roomRecommendationsResponseSchema } from "../../assets/shared/schemas/event-room-recommendations";
import { sessionDemandSchema } from "../../assets/shared/schemas/event-session-demand";
import { formatNumber } from "../../assets/shared/format-number";
import { SessionDemand } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionDemand";
import { SessionEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionEditor";
import { agendaSessionColumns } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/session-table-columns";

const occurrenceId = "d6f76bb0-c741-4637-83eb-c3c7b924992b";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "session-demand",
  timeZone: "UTC",
  revision: 7,
  publishedRevision: 6,
  rooms: [],
  occurrences: [
    {
      id: occurrenceId,
      title: "Unassigned workshop",
      startAt: null,
      endAt: null,
      roomId: null,
      speakers: [],
      track: "Cryptography",
    },
  ],
  blocks: [],
  roleMembers: [],
  assignments: [],
});
const demand = sessionDemandSchema.parse({
  physical: { confirmed: 1234, pending: 12, waitlisted: 7, preferences: 1500 },
  remote: { confirmed: 2500, pending: 3, waitlisted: 9, preferences: 3000 },
});
const response = roomRecommendationsResponseSchema.parse({
  occurrenceId,
  revision: 7,
  demand: {
    physical: { ...demand.physical, occupied: 1299 },
    remote: { ...demand.remote, occupied: 2600 },
  },
  recommendations: [],
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
let host: HTMLElement | undefined;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(editor = false, newSession = false) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      editor ? (
        <SessionEditor
          snapshot={snapshot}
          occurrence={newSession ? undefined : snapshot.occurrences[0]}
          onSaved={() => {}}
          onClose={() => {}}
        />
      ) : (
        <SessionDemand slug={snapshot.eventSlug} occurrenceId={occurrenceId} />
      ),
      host!,
    ),
  );
  await settle();
}
function demandRows() {
  return [...host!.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll(".pk-table__value")].map((cell) => cell.textContent),
  );
}

describe("canonical session demand display", () => {
  it("keeps physical and remote counts separate in compact optional numeric columns", () => {
    const row = agendaOccurrenceListItemSchema.parse({
      ...snapshot.occurrences[0],
      demand,
      conflicts: { hasConflict: false, categories: [] },
    });
    const columns = agendaSessionColumns(snapshot, [], true, () => []);
    for (const [label, status] of [
      ["Confirmed", "confirmed"],
      ["Pending", "pending"],
      ["Waitlisted", "waitlisted"],
    ] as const) {
      const column = columns.find((item) => item.header === label)!;
      expect(column).toMatchObject({ align: "end", width: "fit", defaultHidden: status !== "confirmed" });
      const cell = html(<div>{column.cell(row, 0)}</div>);
      expect(cell).toContain(`In person: ${formatNumber(response.demand.physical[status])}`);
      expect(cell).toContain(`Remote: ${formatNumber(response.demand.remote[status])}`);
      expect(cell).not.toContain(formatNumber(response.demand.physical.occupied));
      expect(cell).not.toContain(formatNumber(response.demand.physical.preferences));
    }
    const track = columns.find((item) => item.header === "Track")!;
    expect(track).toMatchObject({ defaultHidden: true, filter: { param: "track" } });
    expect(html(<div>{track.cell(row, 0)}</div>)).toContain("Cryptography");
  });

  it("reads one unassigned session and preserves live demand while editing a scheduling draft", async () => {
    let live = response;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `/api/v1/events/session-demand/agenda/occurrences/${occurrenceId}/room-recommendations`,
      );
      expect(init?.method ?? "GET").toBe("GET");
      return json(live);
    });
    vi.stubGlobal("fetch", fetcher);
    await mount(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(demandRows()).toEqual([
      ["In person", formatNumber(1234), formatNumber(12), formatNumber(7), formatNumber(1500)],
      ["Remote", formatNumber(2500), formatNumber(3), formatNumber(9), formatNumber(3000)],
    ]);
    const before = JSON.stringify(snapshot);
    const start = host!.querySelector<HTMLInputElement>('[name="startAt"]')!;
    await act(() => {
      start.value = "2026-12-01T10:00";
      start.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(demandRows()[0]).toEqual(["In person", formatNumber(1234), "12", "7", formatNumber(1500)]);
    expect(JSON.stringify(snapshot)).toBe(before);
    live = roomRecommendationsResponseSchema.parse({
      ...response,
      demand: { ...response.demand, physical: { ...response.demand.physical, pending: 13 } },
    });
    await act(() =>
      [...host!.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Refresh demand")!
        .click(),
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(demandRows()[0][2]).toBe("13");
    expect(start.value).toBe("2026-12-01T10:00");
    expect(host!.textContent).toContain("Saved preferences express interest, not reserved places");
  });

  it("does not fetch demand for a new unsaved session", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await mount(true, true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(host!.querySelector('[aria-label="Current session demand"]')).toBeNull();
  });

  it("shows loading and a server refusal without inventing zero counts, then retries the same selected session", async () => {
    let resolve: ((value: Response) => void) | undefined;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce(json(response));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    expect(host!.textContent).not.toContain(formatNumber(1234));
    await act(() => resolve!(json({ error: { code: "FORBIDDEN", message: "Demand access denied" } }, 403)));
    await settle();
    expect(host!.querySelector('[role="alert"]')?.textContent).toContain("Demand access denied");
    expect(demandRows()).toEqual([]);
    expect(host!.textContent).toContain("Demand unavailable.");
    await act(() => host!.querySelector<HTMLButtonElement>('button[type="button"]')!.click());
    await settle();
    expect(demandRows()[0][1]).toBe(formatNumber(1234));
    expect(host!.querySelector('[role="alert"]')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
