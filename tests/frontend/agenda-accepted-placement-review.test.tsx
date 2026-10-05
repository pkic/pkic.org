// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { AcceptedProposalPlacementReview } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AcceptedProposalPlacementReview";
import { agendaImportSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
const proposalId = "10000000-0000-4000-8000-000000000001";
const roomId = "20000000-0000-4000-8000-000000000001";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "UTC",
  revision: 4,
  publishedRevision: null,
  rooms: [{ id: roomId, name: "Workshop", capacity: 40 }],
  occurrences: [],
  blocks: [],
  roleMembers: [],
  assignments: [],
});
const candidate = { id: proposalId, title: "Accepted talk", startAt: "2026-12-01T09:00:00.000Z", roomId };
let host: HTMLElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});
async function click(label: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((value) => value.textContent === label)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function end(value: string) {
  await act(() => {
    const input = host.querySelector<HTMLInputElement>('[name="proposalPlacement.endAt"]')!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("requires an explicit end and fresh reviewed placement before atomic import, preserving rejected drafts", async () => {
  const requests: ReturnType<typeof agendaImportSchema.parse>[] = [];
  const saved = vi.fn();
  let refusal = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(agendaImportSchema.parse(JSON.parse(String(init.body))));
      if (refusal)
        return Response.json(
          {
            error: { code: "AGENDA_PROPOSAL_REVIEW_CHANGED", message: "The accepted proposal changed. Review again." },
          },
          { status: 409 },
        );
      return Response.json({
        agenda: snapshot,
        imported: 1,
        skipped: 0,
        dryRun: requests.at(-1)!.dryRun,
        reviewRequired: 0,
        placementFingerprint: "a".repeat(64),
        placementPreview: {
          title: "Current accepted title",
          description: "Current accepted abstract",
          speakerCount: 2,
        },
      });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  const draw = (revision: number) =>
    render(
      <AcceptedProposalPlacementReview
        snapshot={{ ...snapshot, revision }}
        candidate={candidate}
        onSaved={saved}
        onClose={vi.fn()}
      />,
      host,
    );
  await act(() => draw(4));
  expect(host.querySelector<HTMLInputElement>('[name="proposalPlacement.endAt"]')!.value).toBe("");
  await click("Review placement");
  expect(requests).toHaveLength(0);
  await end("2026-12-01T10:00");
  await click("Review placement");
  expect(requests[0].dryRun).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Reviewed proposal content"]')?.textContent).toContain(
    "Current accepted title",
  );
  expect(host.textContent).toContain("Current accepted abstract");
  expect(host.textContent).toContain("2 confirmed speakers");
  expect(host.querySelector('[aria-label="Reviewed proposal content"]')?.textContent).not.toContain(candidate.title);
  await end("2026-12-01T10:30");
  expect(host.querySelector('[aria-label="Reviewed proposal content"]')).toBeNull();
  expect([...host.querySelectorAll("button")].find((value) => value.textContent === "Save placement")!.disabled).toBe(
    true,
  );
  await click("Review placement");
  await act(() => draw(5));
  expect([...host.querySelectorAll("button")].find((value) => value.textContent === "Save placement")!.disabled).toBe(
    true,
  );
  await click("Review placement");
  refusal = true;
  await click("Save placement");
  expect(saved).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('[name="proposalPlacement.endAt"]')!.value).toBe("2026-12-01T10:30");
  refusal = false;
  await click("Review placement");
  await click("Save placement");
  expect(saved).toHaveBeenCalledOnce();
  expect(requests.at(-1)).toMatchObject({
    dryRun: false,
    expectedRevision: 5,
    source: "accepted_proposals",
    expectedPlacementFingerprint: "a".repeat(64),
    proposalIds: [proposalId],
    proposalPlacement: {
      proposalId,
      roomId,
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      additionalRoomIds: [],
    },
  });
});
