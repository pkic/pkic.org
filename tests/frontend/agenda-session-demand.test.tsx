// @vitest-environment jsdom
import { render } from "preact";
import { render as html } from "preact-render-to-string";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agendaOccurrenceListItemSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { roomRecommendationsResponseSchema } from "../../assets/shared/schemas/event-room-recommendations";
import { sessionDemandSchema } from "../../assets/shared/schemas/event-session-demand";
import { formatNumber } from "../../assets/shared/format-number";
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
  shifts: [],
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
vi.mock("../../assets/ts/components/markdown-editor/MarkdownInput", () => ({ MarkdownEditor: () => null }));
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(newSession = false) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <SessionEditor
        snapshot={snapshot}
        occurrence={newSession ? undefined : snapshot.occurrences[0]}
        onSaved={() => {}}
        onClose={() => {}}
      />,
      host!,
    ),
  );
  await settle();
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
      ["Reserved", "confirmed"],
      ["Pending approval", "pending"],
      ["Waitlisted", "waitlisted"],
    ] as const) {
      const column = columns.find((item) => item.header === label)!;
      expect(column).toMatchObject({ align: "end", width: "fit", defaultHidden: status !== "confirmed" });
      const cell = html(<div>{column.cell(row, 0)}</div>);
      const meaning =
        status === "confirmed"
          ? "reservations"
          : status === "pending"
            ? "reservations awaiting approval"
            : "waitlisted participants";
      expect(cell).toContain(`aria-label="In-person ${meaning}: ${formatNumber(response.demand.physical[status])}"`);
      expect(cell).toContain(`aria-label="Remote ${meaning}: ${formatNumber(response.demand.remote[status])}"`);
      expect(cell).not.toContain(formatNumber(response.demand.physical.occupied));
      expect(cell).not.toContain(formatNumber(response.demand.physical.preferences));
    }
    const track = columns.find((item) => item.header === "Track")!;
    expect(track).toMatchObject({ defaultHidden: true, filter: { param: "track" } });
    expect(html(<div>{track.cell(row, 0)}</div>)).toContain("Cryptography");
  });

  it("keeps live demand out of the session editor, which never reads it", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).not.toContain("/room-recommendations");
      return json(response);
    });
    vi.stubGlobal("fetch", fetcher);
    for (const newSession of [false, true]) {
      await mount(newSession);
      expect(host!.querySelector('[aria-label="Current session demand"]')).toBeNull();
      expect(host!.textContent).not.toContain("Refresh demand");
      render(null, host!);
      host!.remove();
      host = undefined;
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
