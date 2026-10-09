// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { agendaSnapshotSchema, agendaOccurrencePatchSchema } from "../../assets/shared/schemas/event-agenda";
import { emptySessionDemandCounts } from "../../assets/shared/schemas/event-session-demand";
import { roomRecommendationsResponseSchema } from "../../assets/shared/schemas/event-room-recommendations";
import { runRowAction, openRowMenu, menuItemNamed } from "./helpers/row-actions";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Blue hall", capacity: 80 }],
  occurrences: [
    {
      id: "20000000-0000-4000-8000-000000000042",
      title: "Original workshop",
      description: "",
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
const demand = roomRecommendationsResponseSchema.parse({
  occurrenceId: snapshot.occurrences[0]!.id,
  revision: snapshot.revision,
  demand: {
    physical: { ...emptySessionDemandCounts(), occupied: 0 },
    remote: { ...emptySessionDemandCounts(), occupied: 0 },
  },
  recommendations: [],
});
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Enable agenda editing"]')!.click());
  await settle();
  await runRowAction(host, "Original workshop", "Edit session");
  await vi.waitFor(() => expect(host.querySelector('[name="title"]')).not.toBeNull());
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
        if (String(_url).endsWith("/room-recommendations")) return json(demand);
        if (init.method === "PATCH") {
          bodies.push(JSON.parse(String(init.body)));
          writes++;
          return json(
            writes === 1
              ? {
                  ...snapshot,
                  revision: 8,
                  occurrences: [{ ...snapshot.occurrences[0], title: "Updated workshop" }],
                }
              : { ...snapshot, revision: 9 },
          );
        }
        return json(snapshot);
      }),
    );
    await edit();
    await runRowAction(host, "Agenda", "Undo last session edit");
    await settle();
    const body = agendaOccurrencePatchSchema.parse(bodies[1]);
    expect(body.expectedRevision).toBe(8);
    expect(body.title).toBe("Original workshop");
  });
  it("refreshes after a concurrent edit prevents undo", async () => {
    let writes = 0;
    let reads = 0;
    let demandReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (String(_url).endsWith("/room-recommendations")) {
          demandReads++;
          return json(demand);
        }
        if (init.method === "PATCH") {
          writes++;
          return writes === 1
            ? json({
                ...snapshot,
                revision: 8,
                occurrences: [{ ...snapshot.occurrences[0], title: "Updated workshop" }],
              })
            : json(
                {
                  error: {
                    code: "CONFLICT",
                    message: "Another organizer changed the agenda.",
                  },
                },
                409,
              );
        }
        expect(new URL(String(_url), "https://example.test").pathname).toBe("/api/v1/events/synthetic/agenda");
        reads++;
        return json(
          reads === 1
            ? snapshot
            : {
                ...snapshot,
                revision: 9,
                occurrences: [
                  {
                    ...snapshot.occurrences[0],
                    title: "Another organizer's session",
                  },
                ],
              },
        );
      }),
    );
    await edit();
    await runRowAction(host, "Agenda", "Undo last session edit");
    await settle();
    await settle();
    expect(reads).toBe(2);
    // Live demand is a statistic; the session editor never reads it.
    expect(demandReads).toBe(0);
    expect(host.textContent).toContain("Another organizer's session");
    expect(host.textContent).toContain("Another organizer changed the agenda.");
    await openRowMenu(host, "Agenda");
    expect(menuItemNamed(host, "Undo last session edit")).toBeNull();
  });
});

it("restores credit roles and exact placements when undoing a content edit", async () => {
  const placed = agendaSnapshotSchema.parse({
    ...snapshot,
    occurrences: [
      {
        ...snapshot.occurrences[0],
        speakers: [
          {
            userId: "speaker",
            displayName: "Speaker",
            role: "panelist",
            attendanceMode: "physical",
            roomId: "room",
          },
        ],
      },
    ],
  });
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      if (String(_url).endsWith("/room-recommendations")) return json(demand);
      if (init.method !== "PATCH") return json(placed);
      bodies.push(JSON.parse(String(init.body)));
      return json(
        bodies.length === 1
          ? {
              ...placed,
              revision: 8,
              occurrences: [
                {
                  ...placed.occurrences[0],
                  title: "Updated workshop",
                  speakers: [{ ...placed.occurrences[0].speakers[0], role: "moderator" }],
                },
              ],
            }
          : { ...placed, revision: 9 },
      );
    }),
  );
  await edit();
  await runRowAction(host, "Agenda", "Undo last session edit");
  await settle();
  const body = agendaOccurrencePatchSchema.parse(bodies[1]);
  expect(body.speakerRoles).toEqual({ speaker: "panelist" });
  expect(body.speakerPlacements).toEqual({
    speaker: { attendanceMode: "physical", roomId: "room" },
  });
});
