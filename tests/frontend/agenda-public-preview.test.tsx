// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { AgendaPublicPreview } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaPublicPreview";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";

let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
it("switches server-projected revisions without editing or publication writes and reports unavailable approval", async () => {
  const snapshot = agendaSnapshotSchema.parse({
    eventSlug: "synthetic",
    timeZone: "UTC",
    revision: 3,
    publishedRevision: null,
    rooms: [],
    occurrences: [],
    shifts: [],
    roleMembers: [],
    assignments: [],
  });
  const fetcher = vi.fn(async (url: string, _init: RequestInit) =>
    String(url).includes("revision=approved")
      ? new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "No approved agenda revision" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
      : new Response(JSON.stringify(snapshot), { headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetcher);
  document.adoptedStyleSheets = [];
  host = document.createElement("div");
  document.body.append(host);
  history.replaceState(null, "", "/portal/#/groups/group/events/event/agenda/revisions/preview");
  await act(() => render(<AgendaPublicPreview slug="synthetic" />, host));
  await settle();
  expect(host.textContent).toContain("No public scheduled sessions");
  expect(host.querySelector("form")).toBeNull();
  await act(() => {
    const revision = host.querySelector<HTMLSelectElement>("select")!;
    revision.value = "approved";
    revision.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  expect(host.textContent).toContain("No approved agenda revision");
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    "/api/v1/events/synthetic/agenda/previews?revision=draft",
    "/api/v1/events/synthetic/agenda/previews?revision=approved",
  ]);
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.textContent).not.toContain("Back to agenda");
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
