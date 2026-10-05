import { AgendaSessionTable } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaSessionTable";
import {
  listFilterOptionsQuerySchema,
  listFilterOptionsResponseSchema,
} from "../../assets/shared/schemas/list-filter-options";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiDataTable } from "../../assets/ts/components/ApiDataTable";
import { agendaSessionColumns } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/session-table-columns";
import {
  agendaSnapshotSchema,
  agendaOccurrenceListSchema,
  agendaOccurrenceQuerySchema,
  agendaConflictCoverageSchema,
} from "../../assets/shared/schemas/event-agenda";
import { emptySessionDemandCounts } from "../../assets/shared/schemas/event-session-demand";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "conflicts",
  timeZone: "UTC",
  revision: 1,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  blocks: [],
  roleMembers: [],
  assignments: [],
});
const row = {
  id: "one",
  title: "Workshop",
  description: "",
  startAt: "2026-12-01T09:00:00.000Z",
  endAt: "2026-12-01T10:00:00.000Z",
  roomId: null,
  speakers: [],
};
let host: HTMLElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(
  conflicted: boolean,
  coverage: ReturnType<typeof agendaConflictCoverageSchema.parse> = "complete",
) {
  document.adoptedStyleSheets = [];
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(String(input), "https://example.test");
      requests.push(url);
      const query = agendaOccurrenceQuerySchema.parse(Object.fromEntries(url.searchParams));
      const filteredOut = query.conflict === "clear" && conflicted;
      const response = agendaOccurrenceListSchema.parse({
        occurrences: filteredOut
          ? []
          : [
              {
                ...row,
                ...(coverage === "not_scheduled" ? { startAt: null, endAt: null } : {}),
                demand: {
                  physical: emptySessionDemandCounts(),
                  remote: emptySessionDemandCounts(),
                },
                conflicts: {
                  hasConflict: conflicted,
                  categories: conflicted ? ["speaker_conflict", "room_setup"] : [],
                  coverage,
                },
              },
            ],
        page: {
          limit: query.limit,
          offset: query.offset,
          total: filteredOut ? 0 : 1,
          hasMore: false,
        },
      });
      return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <ApiDataTable
        endpoint="/api/v1/events/conflicts/agenda/occurrences"
        responseSchema={agendaOccurrenceListSchema}
        resolve={(response) => response.occurrences}
        resolvePage={(response) => response.page}
        paginate
        caption="All sessions"
        rowKey={(item) => item.id}
        columns={agendaSessionColumns(snapshot, [], false, () => [])}
      />,
      host,
    ),
  );
  await settle();
  return requests;
}
describe("compact agenda scheduling conflicts", () => {
  it("pages canonical speaker choices independently of the loaded snapshot and filters sessions on the server", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(String(input), "https://example.test");
        requests.push(url);
        let response;
        if (url.pathname.endsWith("/filters")) {
          const query = listFilterOptionsQuerySchema.parse(Object.fromEntries(url.searchParams));
          response = listFilterOptionsResponseSchema.parse({
            options: [
              {
                value: query.offset ? "outside-speaker" : "first-speaker",
                label: query.offset ? "Speaker outside loaded day" : "First speaker",
              },
            ],
            page: { limit: 50, offset: query.offset, total: 51, hasMore: query.offset === 0 },
          });
        } else
          response = agendaOccurrenceListSchema.parse({
            occurrences: [],
            page: { limit: 50, offset: 0, total: 0, hasMore: false },
          });
        return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
      }),
    );
    document.adoptedStyleSheets = [];
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<AgendaSessionTable data={snapshot} days={[]} canAct={false} actions={() => []} />, host));
    await settle();
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Choose columns"]')!.click());
    await act(() =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')]
        .find((button) => button.textContent?.includes("Speakers"))!
        .click(),
    );
    const openChoices = async () => {
      await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Speakers column options"]')!.click());
      await act(() => document.querySelector<HTMLButtonElement>('[role="menu"] [aria-haspopup="menu"]')!.click());
    };
    await openChoices();
    await act(() =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')]
        .find((button) => button.textContent?.includes("More choices"))!
        .click(),
    );
    await settle();
    expect(requests.some((url) => url.pathname.endsWith("/filters") && url.searchParams.get("offset") === "50")).toBe(
      true,
    );
    let choice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((button) =>
      button.textContent?.includes("Speaker outside loaded day"),
    );
    if (!choice) {
      await openChoices();
      choice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((button) =>
        button.textContent?.includes("Speaker outside loaded day"),
      );
    }
    expect(choice).toBeDefined();
    await act(() => choice!.click());
    await settle();
    const filtered = requests.filter((url) => !url.pathname.endsWith("/filters")).at(-1)!;
    expect(agendaOccurrenceQuerySchema.parse(Object.fromEntries(filtered.searchParams)).speakerUserId).toBe(
      "outside-speaker",
    );
  });

  it("starts with a concise operational table and keeps other columns selectable", async () => {
    await mount(false);
    const headers = [...host.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim());
    expect(headers).toEqual(["Session", "Day", "Time", "Location", "Confirmed", "Conflicts", "Actions"]);
    expect(host.querySelector("tbody td")?.classList.contains("pk-table__col--primary")).toBe(true);
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Choose columns"]')!.click());
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const options = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    for (const label of [
      "Admission",
      "Visibility",
      "Type",
      "Speakers",
      "Track",
      "Pending",
      "Waitlisted",
      "Access",
      "Publication",
    ])
      expect(options.some((button) => button.textContent?.includes(label))).toBe(true);
    await act(() => options.find((button) => button.textContent?.includes("Publication"))!.click());
    expect([...host.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim())).toContain("Publication");
  });

  it("shows accessible reasons without exposing other sessions or people", async () => {
    await mount(true);
    const badge = host.querySelector(
      '[aria-label="Needs attention: speaker overlap or travel time, location setup time"]',
    );
    expect(badge?.textContent).toBe("Needs attention");
    expect(badge?.classList.contains("pk-badge--warn")).toBe(true);
    expect(host.textContent).not.toContain("userId");
    expect(host.textContent).not.toContain("speaker_conflict");
  });
  it("labels a verified conflict-free row", async () => {
    await mount(false);
    expect(host.querySelector('[aria-label="No scheduling conflicts"]')?.textContent).toBe("Clear");
  });
  it.each([
    ["incomplete", "Needs review", "pk-badge--warn"],
    ["not_scheduled", "Not checked", "pk-badge--neutral"],
  ] as const)("does not label %s checks as verified conflict-free", async (coverage, label, tone) => {
    await mount(false, coverage);
    const badge = [...host.querySelectorAll<HTMLElement>(".pk-badge")].find((item) => item.textContent === label);
    expect(badge).toBeDefined();
    expect(badge?.classList.contains(tone)).toBe(true);
    expect(host.querySelector('[aria-label="No scheduling conflicts"]')).toBeNull();
    expect(host.querySelector(".pk-badge--ok")).toBeNull();
  });
  it("sends the column filter to the server and renders its empty result", async () => {
    const requests = await mount(true);
    await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Conflicts column options"]')!.click());
    const popup = document.querySelector<HTMLElement>('[role="menu"]')!;
    await act(() => popup.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
    const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((button) =>
      button.textContent?.includes("No conflicts"),
    )!;
    await act(() => choice.click());
    await settle();
    expect(agendaOccurrenceQuerySchema.parse(Object.fromEntries(requests.at(-1)!.searchParams)).conflict).toBe("clear");
    expect(host.querySelector('[aria-label^="Needs attention:"]')).toBeNull();
    expect(host.textContent).not.toContain(row.title);
    expect(host.textContent).toContain("No data");
  });
});
