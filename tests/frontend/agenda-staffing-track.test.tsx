// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { agendaSnapshotSchema, agendaStaffingSchema } from "../../assets/shared/schemas/event-agenda";
import { StaffingSetup } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/StaffingSetup";
import { controlFor, chooseComboboxOption, openCombobox, chooseOption } from "./helpers/labelled-control";

const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "UTC",
  revision: 4,
  publishedRevision: null,
  rooms: [{ id: "hall", name: "Main hall", capacity: 20 }],
  occurrences: [],
  shifts: [
    {
      id: "shift",
      name: "Program duties",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
      roomId: "hall",
      track: "Cryptography",
      roles: ["mc"],
    },
  ],
  roleMembers: [],
  assignments: [],
});
let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});
async function mount() {
  const bodies: unknown[] = [];
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(snapshot), { headers: { "content-type": "application/json" } });
      }
      requests.push(new URL(url, "https://example.test"));
      return new Response(
        JSON.stringify({
          options: [
            { value: "Cryptography", label: "Cryptography" },
            { value: "Operations", label: "Operations" },
          ],
          page: { limit: 25, offset: 0, total: 2, hasMore: false },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <StaffingSetup snapshot={snapshot} kind="shift" editId="shift" onSaved={() => {}} onClose={() => {}} />,
      host,
    ),
  );
  return { bodies, requests };
}
async function save() {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("selects an existing event track while preserving the location intersection", async () => {
  const { bodies, requests } = await mount();
  const picker = controlFor(host, "Track");
  expect(picker.value).toBe("Cryptography");
  await openCombobox(host, "Track");
  await vi.waitFor(() => expect(host.querySelectorAll('[role="option"]')).toHaveLength(3));
  await chooseComboboxOption(host, "Track", "Operations");
  await save();
  const body = agendaStaffingSchema.parse(bodies[0]);
  expect(body.shifts[0]).toMatchObject({ id: "shift", roomId: "hall", track: "Operations" });
  expect(
    requests.some(
      (url) =>
        url.pathname.endsWith("/agenda/occurrences/filters") &&
        url.searchParams.get("field") === "track" &&
        url.searchParams.get("limit") === "25",
    ),
  ).toBe(true);
});
it("clears track scope without clearing the selected physical location", async () => {
  const { bodies } = await mount();
  await openCombobox(host, "Track");
  await chooseComboboxOption(host, "Track", "");
  await save();
  expect(agendaStaffingSchema.parse(bodies[0]).shifts[0]).toMatchObject({ roomId: "hall", track: null });
});
it("keeps track scope across all locations", async () => {
  const { bodies } = await mount();
  await chooseOption(controlFor(host, "Location"), "");
  await save();
  expect(agendaStaffingSchema.parse(bodies[0]).shifts[0]).toMatchObject({ roomId: null, track: "Cryptography" });
});
