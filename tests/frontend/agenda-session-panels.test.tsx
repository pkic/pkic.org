// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, it, expect, vi } from "vitest";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { menuItemNamed, runRowAction } from "./helpers/row-actions";
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaGeometry", () => ({
  AgendaGeometry: () => null,
}));
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "UTC",
  revision: 7,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Hall", capacity: 100 }],
  occurrences: [
    {
      id: "session",
      title: "Cryptographic operations",
      description: "Substantive public session description for this event.",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
      roomId: "room",
      speakers: [],
    },
  ],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
it("opens archive and promotion panels directly from the loaded agenda before any local mutation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("history/materials")
              ? { versions: [], page: { limit: 200, offset: 0, total: 0, hasMore: false } }
              : url.includes("history/identities")
                ? { identities: [], page: { limit: 200, offset: 0, total: 0, hasMore: false } }
                : snapshot,
          ),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    render(<AgendaEditor slug="synthetic" canEdit />, host);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Cryptographic operations"));
  await runRowAction(host, "Cryptographic operations", "Session archive / materials");
  expect([...host.querySelectorAll("label")].some((label) => label.textContent?.startsWith("Prerequisites"))).toBe(
    true,
  );
  expect(host.querySelector("form textarea")).not.toBeNull();
  await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Session archive actions"]')!.click());
  await act(() => menuItemNamed(host, "Close")!.click());
  await runRowAction(host, "Cryptographic operations", "Speaker promotion kit");
  expect([...host.querySelectorAll("label")].some((label) => label.textContent?.startsWith("Why attend"))).toBe(true);
  expect(host.querySelector("form textarea")).not.toBeNull();
});
