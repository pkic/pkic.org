// @vitest-environment jsdom
import { AgendaPublicationWorkspace } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaPublicationWorkspace";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentChildren } from "preact";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { agendaPublicationSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { runRowAction } from "./helpers/row-actions";
vi.mock("../../assets/ts/components/ApiDataTable", () => ({
  ApiDataTable: ({
    toolbar,
    createAction,
  }: {
    toolbar?: () => ComponentChildren;
    createAction?: { label: string; onSelect: () => void };
  }) => (
    <div>
      <div role="toolbar">
        {toolbar?.()}
        {createAction && <button onClick={createAction.onSelect}>{createAction.label}</button>}
      </div>
      <table>
        <caption>Sessions across all days</caption>
        <tbody>
          <tr>
            <td>Session record</td>
          </tr>
        </tbody>
      </table>
    </div>
  ),
}));
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "event",
  timeZone: "UTC",
  revision: 1,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  shifts: [],
  assignments: [],
  roleMembers: [],
});
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

it("keeps agenda actions at card scope and list creation in the table toolbar and opens publication status and approval only in a dedicated view", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const fetcher = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(init?.method === "POST" ? { ...snapshot, revision: 2, publishedRevision: 2 } : snapshot),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await act(() => render(<AgendaEditor slug="event" canEdit />, host));
  await settle();
  await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Enable agenda editing"]')!.click());
  await settle();
  await act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Schedule")!
      .click(),
  );
  await settle();
  expect(host.querySelector("table")).not.toBeNull();
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).not.toContain("Draft revision");
  expect(host.textContent).not.toContain("Approve for publication");
  const menu = host.querySelector<HTMLButtonElement>('[aria-label="Actions for Agenda"]');
  expect(menu?.closest(".pk-agenda-workspace-header")).not.toBeNull();
  expect(menu?.closest('[role="toolbar"]')).toBeNull();
  expect(host.querySelectorAll('[aria-label="Actions for Agenda"]')).toHaveLength(1);
  const selected = host.querySelector('[role="tab"][aria-selected="true"]');
  expect(selected?.textContent).toBe("Schedule");
  expect(document.getElementById(selected!.getAttribute("aria-controls")!)).toBe(
    host.querySelector('[role="tabpanel"]:not([hidden])'),
  );
  expect(
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "New session")
      ?.closest('[role="toolbar"]'),
  ).not.toBeNull();
  await act(() => {
    selected!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  await settle();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Agenda");
  await act(() => {
    host
      .querySelector('[role="tab"][aria-selected="true"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  await settle();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Schedule");
  await runRowAction(host, "Agenda", "Review for publication");
  await settle();
  expect(host.querySelector("table")).toBeNull();
  expect(host.querySelector("dt")?.textContent).toBe("Draft revision");
  expect(host.textContent).toContain("Approve for publication");
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  await act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Approve for publication")!
      .click(),
  );
  await settle();
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(agendaPublicationSchema.parse(JSON.parse(String(writes[0]![1]?.body)))).toEqual({
    expectedRevision: 1,
    acknowledgeArchiveRepresentation: false,
  });
  await act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Back to agenda")!
      .click(),
  );
  await settle();
  expect(host.querySelector("table")).not.toBeNull();
  expect(host.textContent).not.toContain("Draft revision");
  expect(host.textContent).not.toContain("Approve for publication");
});

it("requires explicit historical source acknowledgment and does not carry it to a changed review", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const historical = agendaSnapshotSchema.parse({
    ...snapshot,
    occurrences: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        title: "Historical talk",
        startAt: "2023-11-07T09:00:00.000Z",
        endAt: "2023-11-07T09:30:00.000Z",
        roomId: null,
        speakers: [],
        history: {
          archivalCredits: [
            {
              sourceRef: "source-speaker",
              sourcePath: "content/events/2023/agenda.md",
              sourceDigest: "a".repeat(64),
              provenance: "authored_public",
              displayName: "Recorded speaker",
              jobTitle: null,
              organizationName: null,
              photoUrl: null,
            },
          ],
        },
      },
    ],
  });
  const creditlessUnknown = agendaSnapshotSchema.parse({
    ...historical,
    occurrences: [
      {
        id: "10000000-0000-4000-8000-000000000002",
        title: "Closing",
        startAt: null,
        endAt: null,
        roomId: null,
        speakers: [],
        history: {
          archivalTiming: {
            sourcePath: "content/events/2023/agenda.md",
            sourceDigest: "a".repeat(64),
            provenance: "authored_public",
            timeZone: "UTC",
            authoredDate: "2023-11-07",
            authoredStart: "17:00",
            startAt: "2023-11-07T17:00:00.000Z",
            endAt: null,
          },
        },
      },
    ],
  });
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(agendaPublicationSchema.parse(JSON.parse(String(init?.body))));
      return new Response(JSON.stringify(historical), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const saved = vi.fn();
  await act(() =>
    render(<AgendaPublicationWorkspace snapshot={historical} canEdit onSaved={saved} onClose={() => {}} />, host),
  );
  await settle();
  const approve = () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Approve for publication",
    )!;
  expect(approve().disabled).toBe(true);
  expect(host.textContent).toContain("Slides and recordings need separate approval");
  const acknowledgment = host.querySelector<HTMLInputElement>('input[name="acknowledgeArchiveRepresentation"]')!;
  expect(acknowledgment.checked).toBe(false);
  await act(() => acknowledgment.click());
  await settle();
  expect(approve().disabled).toBe(false);
  await act(() => approve().click());
  await settle();
  expect(bodies).toEqual([{ expectedRevision: 1, acknowledgeArchiveRepresentation: true }]);
  expect(saved).toHaveBeenCalledOnce();
  await act(() =>
    render(
      <AgendaPublicationWorkspace
        snapshot={{ ...creditlessUnknown, revision: 2 }}
        canEdit
        onSaved={saved}
        onClose={() => {}}
      />,
      host,
    ),
  );
  expect(host.querySelector<HTMLInputElement>('input[name="acknowledgeArchiveRepresentation"]')!.checked).toBe(false);
  await settle();
  expect(host.querySelector<HTMLInputElement>('input[name="acknowledgeArchiveRepresentation"]')!.checked).toBe(false);
  expect(approve().disabled).toBe(true);
  expect(host.textContent).toContain("1 session end times not recorded");
  expect(host.textContent).toContain("0 speaker credits from the original agenda");
  expect(bodies).toHaveLength(1);
});
