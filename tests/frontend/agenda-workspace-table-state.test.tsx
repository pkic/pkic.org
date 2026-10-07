// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  agendaOccurrenceListSchema,
  agendaOccurrenceQuerySchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { listFilterOptionsResponseSchema } from "../../assets/shared/schemas/list-filter-options";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";

const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "query-state",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Blue hall", capacity: 80 }],
  occurrences: [
    {
      id: "session",
      title: "Migration workshop",
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
let host: HTMLElement | undefined;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/portal/#/events/query-state/agenda");
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(label: string) {
  const button = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label,
  );
  expect(button).toBeDefined();
  await act(() => button!.click());
  await settle();
}

it("restores the server query and selection across workspace views without fetching inactive tables", async () => {
  history.replaceState(
    null,
    "",
    "/portal/#/events/query-state/agenda?agenda.q=migration&agenda.sort=-title&agenda.offset=50&agenda.size=25&agenda.f.day=2026-12-01&agenda.f.roomId=room&agenda.f.kind=session&agenda.f.accessPolicy=open&agenda.f.publicationStatus=changed&agenda.f.conflict=incomplete&other.q=keep",
  );
  const requests: URL[] = [];
  const tableSignals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://example.test");
      requests.push(url);
      if (url.pathname.includes("/occurrences") && init?.signal) tableSignals.push(init.signal);
      let response: unknown = snapshot;
      if (url.pathname.endsWith("/filters")) {
        response = listFilterOptionsResponseSchema.parse({
          options: [],
          page: { limit: 50, offset: 0, total: 0, hasMore: false },
        });
      } else if (url.pathname.endsWith("/occurrences")) {
        const query = agendaOccurrenceQuerySchema.parse(Object.fromEntries(url.searchParams));
        response = agendaOccurrenceListSchema.parse({
          occurrences: [
            {
              ...snapshot.occurrences[0],
              demand: {
                physical: { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0 },
                remote: { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0 },
              },
              conflicts: { hasConflict: false, categories: [], coverage: "incomplete" },
            },
          ],
          page: { limit: query.limit, offset: query.offset, total: 100, hasMore: query.offset + query.limit < 100 },
        });
      }
      return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
    }),
  );
  document.adoptedStyleSheets = [];
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<AgendaEditor slug={snapshot.eventSlug} canEdit />, host!));
  await settle();
  expect(requests.some((url) => url.pathname.endsWith("/occurrences"))).toBe(false);
  await click("Schedule");
  const query = () =>
    agendaOccurrenceQuerySchema.parse(
      Object.fromEntries(requests.filter((url) => url.pathname.endsWith("/occurrences")).at(-1)!.searchParams),
    );
  expect(query()).toMatchObject({
    q: "migration",
    sort: "-title",
    offset: 50,
    limit: 25,
    day: "2026-12-01",
    roomId: "room",
    kind: "session",
    accessPolicy: "open",
    publicationStatus: "changed",
    conflict: "incomplete",
  });
  await click("Next page");
  expect(query().offset).toBe(75);
  await act(() => host!.querySelector<HTMLInputElement>('input[aria-label="Migration workshop"]')!.click());
  await settle();
  expect(host.textContent).toContain("1 of 1 selected");
  const retainedQuery = location.hash;
  await click("Agenda");
  expect(host.querySelector("table.pk-table")).toBeNull();
  expect(location.hash).toBe(retainedQuery);
  expect(tableSignals.length).toBeGreaterThan(0);
  expect(tableSignals.every((signal) => signal.aborted)).toBe(true);
  const inactiveRequestCount = requests.length;
  await settle();
  expect(requests).toHaveLength(inactiveRequestCount);
  await click("Schedule");
  expect(query()).toMatchObject({
    q: "migration",
    sort: "-title",
    offset: 75,
    limit: 25,
    day: "2026-12-01",
    roomId: "room",
    kind: "session",
    accessPolicy: "open",
    publicationStatus: "changed",
    conflict: "incomplete",
  });
  expect(host.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe("migration");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Migration workshop"]')?.checked).toBe(true);
  await click("Agenda");
  await act(() => render(null, host!));
  expect(location.hash).toBe("#/events/query-state/agenda?other.q=keep");
});
