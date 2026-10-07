import { useState } from "preact/hooks";
import { useUrlTableState } from "../../assets/ts/hooks/useUrlTableState";
import { AgendaSessionTable } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaSessionTable";
import { useAgendaScheduling } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/useAgendaScheduling";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agendaSnapshotSchema, agendaOccurrenceQuerySchema } from "../../assets/shared/schemas/event-agenda";
import { emptySessionDemandCounts } from "../../assets/shared/schemas/event-session-demand";
import {
  agendaScheduleApplySchema,
  agendaScheduleProposalSchema,
  AGENDA_SCHEDULE_BATCH_LIMIT,
} from "../../assets/shared/schemas/event-agenda-schedule";
import { scheduleStep } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/schedule-proposals";
import { stepAgendaSessions } from "../../assets/shared/event-agenda-order";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { runRowAction } from "./helpers/row-actions";
import { AgendaSchedulePreview } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaSchedulePreview";
import { AgendaBulkSchedule } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaBulkSchedule";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "event",
  timeZone: "Europe/Amsterdam",
  revision: 3,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Main", capacity: 100 }],
  blocks: [],
  roleMembers: [],
  assignments: [],
  occurrences: [10, 11, 12].map((hour) => ({
    id: `talk-${hour}`,
    title: `Session ${hour}`,
    description: "",
    startAt: `2026-12-01T${hour}:00:00.000Z`,
    endAt: `2026-12-01T${hour}:30:00.000Z`,
    roomId: "room",
    speakers: [],
  })),
});
let host: HTMLDivElement;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(component: Parameters<typeof render>[0]) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(component, host));
  await settle();
}
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
function SelectionHarness() {
  const [page, setPage] = useState(0);
  const scheduling = useAgendaScheduling("event", snapshot, false, vi.fn(), vi.fn(), vi.fn());
  const item = snapshot.occurrences[page]!;
  scheduling.onTableData({
    occurrences: [
      {
        ...item,
        demand: { physical: emptySessionDemandCounts(), remote: emptySessionDemandCounts() },
        conflicts: { hasConflict: false, categories: [], coverage: "complete" },
      },
    ],
    page: { limit: 1, offset: page, total: 3, hasMore: page < 2 },
  });
  return (
    <>
      {scheduling.bar}
      <button onClick={() => scheduling.selection.onChange(new Set([item.id]))}>Select page</button>
      <button onClick={() => setPage((current) => current + 1)}>Next page</button>
      <output>{[...scheduling.selection.selected].sort().join(",")}</output>
    </>
  );
}
describe("canonical scheduling preview", () => {
  it("unschedules through shared row actions only after canonical revision-bound server review", async () => {
    const applied: unknown[] = [];
    let current = snapshot;
    const proposals: ReturnType<typeof agendaScheduleProposalSchema.parse>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("/schedule/reviews")) {
          const proposal = agendaScheduleProposalSchema.parse(JSON.parse(String(init.body)));
          proposals.push(proposal);
          expect(applied).toHaveLength(0);
          return json({
            expectedRevision: snapshot.revision,
            reviewHash: "b".repeat(64),
            affected: proposal.changes.map((change) => ({
              before: snapshot.occurrences.find((item) => item.id === change.id),
              after: { ...snapshot.occurrences.find((item) => item.id === change.id), ...change },
              beforeOrder: 2,
              afterOrder: null,
            })),
          });
        }
        if (url.endsWith("/schedule")) {
          const body = agendaScheduleApplySchema.parse(JSON.parse(String(init.body)));
          applied.push(body);
          current = {
            ...snapshot,
            revision: 4,
            occurrences: snapshot.occurrences.map((item) =>
              item.id === "talk-11" ? { ...item, startAt: null, endAt: null } : item,
            ),
          };
          return json(current);
        }
        if (url.includes("/occurrences"))
          return json({
            occurrences: [
              {
                ...current.occurrences[1],
                demand: { physical: emptySessionDemandCounts(), remote: emptySessionDemandCounts() },
                conflicts: { hasConflict: false, categories: [] },
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        return json(current);
      }),
    );
    await mount(<AgendaEditor slug="event" canEdit />);
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Schedule")!
        .click(),
    );
    await settle();
    await runRowAction(host, "Session 11", "Unschedule session");
    await settle();
    expect(proposals).toEqual([
      {
        expectedRevision: 3,
        changes: [{ id: "talk-11", startAt: null, endAt: null, roomId: "room", additionalRoomIds: [] }],
      },
    ]);
    expect(current.occurrences[1].startAt).toBeNull();
    expect(current.occurrences[1].endAt).toBeNull();
    expect(host.querySelector("form")).toBeNull();
    expect(applied).toEqual([{ ...proposals[0], reviewHash: "b".repeat(64) }]);
  });
  it("previews a canonical neighbor hidden by table filters, and writes only on explicit apply", async () => {
    const changes = stepAgendaSessions(
      [...snapshot.occurrences].reverse(),
      new Set(["talk-11"]),
      snapshot.timeZone,
      -1,
    );
    const proposal = agendaScheduleProposalSchema.parse({ expectedRevision: 3, changes });
    expect(changes.map((item) => item.id).sort()).toEqual(["talk-10", "talk-11"]);
    const applied: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/reviews")) {
          const body = agendaScheduleProposalSchema.parse(JSON.parse(String(init.body)));
          return json({
            expectedRevision: 3,
            reviewHash: "a".repeat(64),
            affected: body.changes.map((change) => ({
              before: snapshot.occurrences.find((item) => item.id === change.id),
              after: { ...snapshot.occurrences.find((item) => item.id === change.id), ...change },
              beforeOrder: change.id === "talk-10" ? 1 : 2,
              afterOrder: change.id === "talk-10" ? 2 : 1,
            })),
          });
        }
        applied.push(agendaScheduleApplySchema.parse(JSON.parse(String(init.body))));
        return json({ ...snapshot, revision: 4 });
      }),
    );
    await mount(<AgendaSchedulePreview snapshot={snapshot} proposal={proposal} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(host.textContent).toContain("Session 10");
    expect(host.textContent).toContain("Session 11");
    expect(host.textContent).toContain("Europe/Amsterdam");
    expect(host.textContent).toContain("Order 2");
    expect(applied).toHaveLength(0);
    await act(() => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await settle();
    expect(applied).toHaveLength(1);
  });
  it("uses the full canonical agenda for a table row command, including a filtered-out neighbor", async () => {
    const proposals: unknown[] = [];
    const applied: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("/schedule/reviews")) {
          const proposal = agendaScheduleProposalSchema.parse(JSON.parse(String(init.body)));
          proposals.push(proposal);
          expect(applied).toHaveLength(0);
          return json({
            expectedRevision: 3,
            reviewHash: "a".repeat(64),
            affected: proposal.changes.map((change) => ({
              before: snapshot.occurrences.find((item) => item.id === change.id),
              after: { ...snapshot.occurrences.find((item) => item.id === change.id), ...change },
              beforeOrder: 1,
              afterOrder: 2,
            })),
          });
        }
        if (url.endsWith("/schedule")) {
          applied.push(agendaScheduleApplySchema.parse(JSON.parse(String(init.body))));
          return json({ ...snapshot, revision: 4 });
        }
        if (url.includes("/occurrences"))
          return json({
            occurrences: [
              {
                ...snapshot.occurrences[1],
                demand: { physical: emptySessionDemandCounts(), remote: emptySessionDemandCounts() },
                conflicts: { hasConflict: false, categories: [] },
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        return json(snapshot);
      }),
    );
    await mount(<AgendaEditor slug="event" canEdit />);
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Schedule")!
        .click(),
    );
    await settle();
    expect(host.querySelector("table")?.textContent).not.toContain("Session 10");
    await runRowAction(host, "Session 11", "Move up in agenda");
    await settle();
    const proposal = agendaScheduleProposalSchema.parse(proposals[0]);
    expect(proposal.changes.map((item) => item.id).sort()).toEqual(["talk-10", "talk-11"]);
    expect(applied).toEqual([{ ...proposal, reviewHash: "a".repeat(64) }]);
    expect(host.querySelector("form")).toBeNull();
  });

  it("preserves selected IDs when selecting all rows on another server page, and explicitly clears them", async () => {
    await mount(<SelectionHarness />);
    const click = async (name: string) => {
      await act(() =>
        [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === name)!.click(),
      );
      await settle();
    };
    await click("Select page");
    await click("Next page");
    await click("Select page");
    expect(host.querySelector("output")?.textContent).toBe("talk-10,talk-11");
    await click("Clear selection");
    expect(host.querySelector("output")?.textContent).toBe("");
  });
  it("keeps actual Sessions-table bulk selection across server pages and reviews the complete canonical selection", async () => {
    const many = agendaSnapshotSchema.parse({
      ...snapshot,
      occurrences: Array.from({ length: 51 }, (_, index) => ({
        ...snapshot.occurrences[0],
        id: `row-${index}`,
        title: `Paged session ${index}`,
        startAt: new Date(Date.parse(snapshot.occurrences[0].startAt!) + index * 1800000).toISOString(),
        endAt: new Date(Date.parse(snapshot.occurrences[0].startAt!) + (index + 1) * 1800000).toISOString(),
      })),
    });
    const proposals: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(String(input), "https://example.test");
        if (url.pathname.endsWith("/filters"))
          return json({ options: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
        if (url.pathname.endsWith("/occurrences")) {
          const query = agendaOccurrenceQuerySchema.parse(Object.fromEntries(url.searchParams));
          return json({
            occurrences: many.occurrences.slice(query.offset, query.offset + query.limit).map((row) => ({
              ...row,
              demand: { physical: emptySessionDemandCounts(), remote: emptySessionDemandCounts() },
              conflicts: { hasConflict: false, categories: [] },
            })),
            page: { limit: query.limit, offset: query.offset, total: 51, hasMore: query.offset + query.limit < 51 },
          });
        }
        if (url.pathname.endsWith("/schedule/reviews")) {
          const proposal = agendaScheduleProposalSchema.parse(JSON.parse(String(init?.body)));
          proposals.push(proposal);
          return json({
            expectedRevision: many.revision,
            reviewHash: "a".repeat(64),
            affected: proposal.changes.map((change) => ({
              before: many.occurrences.find((row) => row.id === change.id),
              after: { ...many.occurrences.find((row) => row.id === change.id), ...change },
              beforeOrder: 1,
              afterOrder: 2,
            })),
          });
        }
        return json(many);
      }),
    );
    function BulkTableHarness() {
      useUrlTableState("agenda");
      const scheduling = useAgendaScheduling("event", many, false, vi.fn(), vi.fn(), vi.fn());
      return (
        scheduling.panel ?? (
          <AgendaSessionTable
            retainUrlStateOnUnmount
            data={many}
            days={[{ date: "2026-12-01" }, { date: "2026-12-02" }]}
            canAct
            actions={scheduling.actions}
            selection={scheduling.selection}
            onData={scheduling.onTableData}
            toolbar={scheduling.bar}
          />
        )
      );
    }
    await mount(<BulkTableHarness />);
    const click = async (label: string) => {
      await act(() =>
        [...host.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent === label || button.getAttribute("aria-label") === label)!
          .click(),
      );
      await settle();
    };
    await act(() => host.querySelector<HTMLInputElement>('input[aria-label="Paged session 0"]')!.click());
    await settle();
    expect(host.textContent).toContain("1 of 51 selected");
    await click("Next page");
    expect(host.querySelector("table")?.textContent).not.toContain("Paged session 0");
    await act(() => host.querySelector<HTMLInputElement>('input[aria-label="Select all rows"]')!.click());
    await settle();
    expect(host.textContent).toContain("2 of 51 selected");
    await click("Move selected sessions");
    await act(() => {
      const mode = host.querySelector<HTMLSelectElement>('[name="bulkMode"]')!;
      mode.value = "day";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => {
      const day = host.querySelector<HTMLInputElement>('input[type="date"]')!;
      day.value = "2026-12-04";
      day.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(agendaScheduleProposalSchema.parse(proposals[0]).changes.map((row) => row.id)).toEqual(["row-0", "row-50"]);
    expect(host.textContent).toContain("Before and after · 2 sessions");
    await click("Cancel schedule changes");
    expect(host.textContent).toContain("Move 2 selected sessions");
    expect(host.querySelector("table")).toBeNull();
    await click("Cancel bulk move");
    expect(host.textContent).toContain("2 of 51 selected");
    await click("Clear selection");
    expect(host.textContent).not.toContain("2 of 51 selected");
    expect(proposals).toHaveLength(1);
  });

  it("moves multiple selected sessions to a new day with local clock time preserved through the shared contract", async () => {
    const proposals: unknown[] = [];
    await mount(
      <AgendaBulkSchedule
        snapshot={snapshot}
        selected={new Set(["talk-10", "talk-12"])}
        onProposal={(proposal) => proposals.push(agendaScheduleProposalSchema.parse(proposal))}
        onClose={vi.fn()}
      />,
    );
    await act(() => {
      const mode = host.querySelector<HTMLSelectElement>('[name="bulkMode"]')!;
      mode.value = "day";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(() => {
      const day = host.querySelector<HTMLInputElement>('input[type="date"]')!;
      day.value = "2026-12-02";
      day.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const proposal = agendaScheduleProposalSchema.parse(proposals[0]);
    expect(proposal.changes.map((item) => item.startAt)).toEqual([
      "2026-12-02T10:00:00.000Z",
      "2026-12-02T12:00:00.000Z",
    ]);
  });
  it("leaves the schedule unchanged when the server rejects the reviewed proposal", async () => {
    const proposal = agendaScheduleProposalSchema.parse({
      expectedRevision: 3,
      changes: stepAgendaSessions(snapshot.occurrences, new Set(["talk-11"]), snapshot.timeZone, -1),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { code: "AGENDA_SCHEDULE_CONFLICT", message: "A speaker needs travel time." } }, 409),
      ),
    );
    await mount(<AgendaSchedulePreview snapshot={snapshot} proposal={proposal} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(host.textContent).toContain("A speaker needs travel time.");
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
});

it("repacks unequal durations and preserves gaps without moving sessions outside the span", () => {
  const items = snapshot.occurrences.map((item, index) => ({
    ...item,
    startAt: ["2026-12-01T09:00:00.000Z", "2026-12-01T09:50:00.000Z", "2026-12-01T10:20:00.000Z"][index],
    endAt: ["2026-12-01T09:45:00.000Z", "2026-12-01T10:20:00.000Z", "2026-12-01T10:50:00.000Z"][index],
    kind: "session" as const,
  }));
  const changes = stepAgendaSessions(items, new Set([items[0].id]), snapshot.timeZone, 1);
  expect(changes).toHaveLength(2);
  expect(changes.find((item) => item.id === items[1].id)).toMatchObject({
    startAt: "2026-12-01T09:00:00.000Z",
    endAt: "2026-12-01T09:30:00.000Z",
  });
  expect(changes.find((item) => item.id === items[0].id)).toMatchObject({
    startAt: "2026-12-01T09:35:00.000Z",
    endAt: "2026-12-01T10:20:00.000Z",
  });
  expect(changes.some((item) => item.id === items[2].id)).toBe(false);
});

it("keeps a fixed break unchanged instead of displacing it in a bulk step", () => {
  const fixed = snapshot.occurrences.map((item, index) => ({
    ...item,
    kind: index === 1 ? ("break" as const) : ("session" as const),
  }));
  const before = structuredClone(fixed);
  expect(() => stepAgendaSessions(fixed, new Set([fixed[0].id]), snapshot.timeZone, 1)).toThrow("already at the edge");
  expect(fixed).toEqual(before);
});

it("undoes a primary-room move through a reviewed reverse proposal with exact speaker placements", async () => {
  document.adoptedStyleSheets = [];
  const original = agendaSnapshotSchema.parse({
    ...snapshot,
    rooms: [...snapshot.rooms, { id: "other", name: "Other hall", capacity: 100 }],
    occurrences: [
      {
        ...snapshot.occurrences[0],
        speakers: [
          { userId: "speaker", displayName: "Speaker", role: "panelist", attendanceMode: "physical", roomId: "room" },
        ],
      },
    ],
  });
  let current = original;
  const requests: Array<{ url: string; body: ReturnType<typeof agendaScheduleProposalSchema.parse> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (init.method !== "POST") return json(current);
      const body = agendaScheduleProposalSchema.parse(JSON.parse(String(init.body)));
      requests.push({ url, body });
      const next = current.occurrences.map((item) => {
        const change = body.changes.find((value) => value.id === item.id)!;
        return {
          ...item,
          ...change,
          speakers: item.speakers.map((speaker) => ({
            ...speaker,
            roomId: change.roomId,
            ...change.speakerPlacements?.[speaker.userId],
          })),
        };
      });
      if (url.endsWith("/reviews"))
        return json({
          expectedRevision: current.revision,
          reviewHash: "a".repeat(64),
          affected: next.map((item) => ({
            before: current.occurrences.find((before) => before.id === item.id),
            after: item,
            beforeOrder: 1,
            afterOrder: 1,
          })),
        });
      expect(agendaScheduleApplySchema.parse(JSON.parse(String(init.body))).reviewHash).toBe("a".repeat(64));
      current = { ...current, occurrences: next, revision: current.revision + 1 };
      return json(current);
    }),
  );
  await mount(<AgendaEditor slug="event" canEdit />);
  await runRowAction(host, "Session 10", "Move to day / location");
  await act(() => {
    const room = host.querySelector<HTMLSelectElement>('[name="changes.0.roomId"]')!;
    room.value = "other";
    room.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const click = async (name: string) => {
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === name)!.click(),
    );
    await settle();
  };
  await click("Move session");
  expect(current.occurrences[0].speakers[0].roomId).toBe("other");
  await runRowAction(host, "Agenda", "Undo last session edit");
  await settle();
  expect(host.querySelector("dialog[open]")).toBeNull();
  expect(host.querySelector("[aria-label='Agenda days'] [aria-selected='true']")?.getAttribute("aria-controls")).toBe(
    "agenda-day-2026-12-01",
  );
  expect(requests).toHaveLength(4);
  expect(requests[2].url).toBe("/api/v1/events/event/agenda/schedule/reviews");
  expect(requests[2].body).toMatchObject({
    expectedRevision: 4,
    changes: [
      { id: "talk-10", roomId: "room", speakerPlacements: { speaker: { attendanceMode: "physical", roomId: "room" } } },
    ],
  });
  expect(current.revision).toBe(5);
  expect(host.querySelector("table.pk-content-agenda__timeline")).not.toBeNull();
  expect(current.occurrences[0].speakers).toEqual(original.occurrences[0].speakers);
  expect(requests.every((request) => !request.url.endsWith("/swaps"))).toBe(true);
});

it("explains an oversized canonical move before review without losing selections or splitting writes", async () => {
  const sessions = Array.from({ length: AGENDA_SCHEDULE_BATCH_LIMIT * 2 + 1 }, (_, index) => ({
    ...snapshot.occurrences[0],
    id: `session-${index}`,
    title: `Session ${index}`,
    startAt: new Date(Date.UTC(2026, 11, 1, 0, index * 6)).toISOString(),
    endAt: new Date(Date.UTC(2026, 11, 1, 0, index * 6 + 5)).toISOString(),
  }));
  const large = { ...snapshot, occurrences: sessions };
  const ids = new Set(sessions.filter((_, index) => index % 2 === 1).map((item) => item.id));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  function BoundHarness() {
    const [error, setError] = useState("");
    const scheduling = useAgendaScheduling("event", large, false, vi.fn(), vi.fn(), setError);
    return (
      <>
        <button onClick={() => scheduling.selection.onChange(ids)}>Select sessions</button>
        {scheduling.bar}
        {scheduling.panel}
        <output>{error}</output>
        <span data-selected>{scheduling.selection.selected.size}</span>
      </>
    );
  }
  await mount(<BoundHarness />);
  const click = async (label: string) => {
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)!.click(),
    );
    await settle();
  };
  await click("Select sessions");
  await click("Move selected up");
  expect(host.querySelector("output")!.textContent).toBe(
    `This move affects ${AGENDA_SCHEDULE_BATCH_LIMIT * 2} sessions, including neighboring sessions. One change can affect at most ${AGENDA_SCHEDULE_BATCH_LIMIT}. Select fewer sessions and try again.`,
  );
  expect(host.querySelector("[data-selected]")!.textContent).toBe(String(AGENDA_SCHEDULE_BATCH_LIMIT));
  expect(host.textContent).not.toContain("Before and after");
  expect(fetch).not.toHaveBeenCalled();
});

it("allows a canonical step that affects exactly the shared limit, including displaced neighbors", () => {
  const sessions = Array.from({ length: AGENDA_SCHEDULE_BATCH_LIMIT + 1 }, (_, index) => ({
    ...snapshot.occurrences[0],
    id: `session-${index}`,
    startAt: new Date(Date.UTC(2026, 11, 1, 0, index * 6)).toISOString(),
    endAt: new Date(Date.UTC(2026, 11, 1, 0, index * 6 + 5)).toISOString(),
  }));
  const selected = new Set(sessions.filter((_, index) => index % 2 === 1).map((item) => item.id));
  const result = scheduleStep({ ...snapshot, occurrences: sessions }, selected, -1);
  expect(result.changes).toHaveLength(AGENDA_SCHEDULE_BATCH_LIMIT);
  expect(result.expectedRevision).toBe(snapshot.revision);
  expect(result.changes.find((item) => item.id === "session-1")!.startAt).toBe(sessions[0].startAt);
  expect(result.changes.find((item) => item.id === "session-0")!.startAt).toBe(sessions[1].startAt);
  expect(result.changes.some((item) => item.id === sessions.at(-1)!.id)).toBe(false);
});
