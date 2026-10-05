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
    blocks: [],
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
  const close = vi.fn();
  await act(() => render(<AgendaPublicPreview slug="synthetic" onClose={close} />, host));
  await settle();
  expect(host.textContent).toContain("No public scheduled sessions");
  expect(host.querySelector("form")).toBeNull();
  await act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Approved revision")!
      .click(),
  );
  await settle();
  expect(host.textContent).toContain("No approved agenda revision");
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    "/api/v1/events/synthetic/agenda/previews?revision=draft",
    "/api/v1/events/synthetic/agenda/previews?revision=approved",
  ]);
  await act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Back to agenda")!
      .click(),
  );
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});
