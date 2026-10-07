// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentProps } from "preact";
import type { EventProposalsTable } from "../../assets/ts/components/proposals/EventProposalsTable";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { AgendaImport } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaImport";
import { agendaImportSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";

vi.mock("../../assets/ts/components/proposals/EventProposalsTable", () => ({
  EventProposalsTable: ({
    initialFilters,
    toolbarPrefix,
  }: {
    initialFilters: Record<string, string>;
    toolbarPrefix: NonNullable<ComponentProps<typeof EventProposalsTable>["toolbarPrefix"]>;
  }) => {
    expect(initialFilters).toEqual({ status: "accepted" });
    return toolbarPrefix(
      { reload: async () => {}, resetPage: () => {} },
      {
        canRead: true,
        canReview: false,
        canFinalize: false,
        canEditAcceptedAbstract: false,
        canCancelAcceptedProposal: false,
        eventPermissions: [],
      },
      new Set(["proposal-one", "proposal-two"]),
    );
  },
}));

const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "UTC",
  revision: 5,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  blocks: [],
  roleMembers: [],
  assignments: [],
});
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((row) => row.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("selects a bounded proposal batch and reviews it before applying the canonical import", async () => {
  const requests: unknown[] = [];
  const saved = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          imported: 2,
          skipped: 0,
          agenda: snapshot,
          dryRun: agendaImportSchema.parse(requests.at(-1)).dryRun,
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<AgendaImport snapshot={snapshot} onSaved={saved} onClose={() => {}} />, host));
  await click("Choose accepted proposals");
  await click("Use selected proposals");
  expect(requests).toHaveLength(0);
  expect(host.textContent).toContain("2 proposals selected.");
  await click("Preview import");
  expect(requests).toHaveLength(1);
  const review = agendaImportSchema.parse(requests[0]);
  expect(review.proposalIds).toEqual(["proposal-one", "proposal-two"]);
  expect(review.dryRun).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  expect(host.textContent).toContain("2 sessions ready to import");
  await click("Apply import");
  expect(agendaImportSchema.parse(requests[1])).toEqual({ ...review, dryRun: false });
  expect(saved).toHaveBeenCalledWith(snapshot);
});
