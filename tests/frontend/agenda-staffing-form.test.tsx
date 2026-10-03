// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { StaffingEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/StaffingEditor";
import {
  agendaSnapshotSchema,
  agendaAllocationSchema,
  agendaStaffingSchema,
} from "../../assets/shared/schemas/event-agenda";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 4,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  blocks: [
    {
      id: "block",
      name: "Opening to coffee",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
      roomId: null,
      roles: ["mc"],
    },
  ],
  roleMembers: [
    {
      userId: "senior",
      displayName: "Synthetic Senior",
      roles: ["mc"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
    },
  ],
  assignments: [{ blockId: "block", role: "mc", userId: "senior", pinned: true }],
});
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<StaffingEditor snapshot={snapshot} canEdit onSaved={() => {}} />, host));
}
function capture() {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(snapshot), { headers: { "content-type": "application/json" } });
    }),
  );
  return bodies;
}
describe("staffing canonical actions", () => {
  it("generates a saved seeded rotation using the guarded allocation contract", async () => {
    const bodies = capture();
    await mount();
    await act(() => {
      const input = host.querySelector<HTMLInputElement>('[name="seed"]')!;
      input.value = "December conference";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    const body = agendaAllocationSchema.parse(bodies[0]);
    expect(body.expectedRevision).toBe(4);
    expect(body.seed).toBe("December conference");
    expect(host.textContent).toContain("Pinned");
  });
  it("unpins a senior assignment without changing its person or block", async () => {
    const bodies = capture();
    await mount();
    const button = [...host.querySelectorAll("button")].find((value) => value.textContent === "Unpin assignment")!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    const body = agendaStaffingSchema.parse(bodies[0]);
    expect(body.assignments[0].pinned).toBe(false);
    expect(body.assignments[0].userId).toBe("senior");
    expect(body.assignments[0].blockId).toBe("block");
  });
});
