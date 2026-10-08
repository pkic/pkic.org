import { agendaConflictDetails } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/agenda-conflict-details";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agendaOccurrencePatchSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { agendaScheduleProposalSchema } from "../../assets/shared/schemas/event-agenda-schedule";
import { ApiClientError } from "../../assets/ts/shared/api-client";
import { AgendaConflictDetails } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaConflictDetails";
import { AgendaSchedulePreview } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaSchedulePreview";
import { SessionEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionEditor";
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionDemand", () => ({
  SessionDemand: () => null,
}));
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "event",
  timeZone: "Europe/Amsterdam",
  revision: 3,
  publishedRevision: null,
  rooms: [{ id: "main", name: "Main hall", capacity: 100 }],
  shifts: [],
  roleMembers: [],
  assignments: [],
  occurrences: [
    {
      id: "session",
      title: "Edited session",
      description: "",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      roomId: "main",
      speakers: [],
    },
  ],
});
const details = {
  conflicts: ["The selected room is already in use."],
  proposal: {
    timeZone: snapshot.timeZone,
    occurrences: [
      {
        id: "session",
        title: "Edited session",
        startAt: "2026-12-01T11:00:00.000Z",
        endAt: "2026-12-01T11:30:00.000Z",
        roomId: "main",
      },
    ],
  },
};
const refusal = (value: unknown, code = "AGENDA_SCHEDULE_CONFLICT", status = 409) =>
  new ApiClientError({ error: { code, message: "Schedule conflict", details: value } }, status);
let host: HTMLDivElement;
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});
async function mount(value: Parameters<typeof render>[0]) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(value, host));
  await settle();
}
describe("agenda refusal diagnostics", () => {
  it("accepts only canonical agenda conflict refusals, including old safe reasons", () => {
    expect(agendaConflictDetails(refusal({ conflicts: ["Room unavailable"] }))?.conflicts).toEqual([
      "Room unavailable",
    ]);
    expect(agendaConflictDetails(refusal({ conflicts: [7] }))).toBeNull();
    expect(agendaConflictDetails(refusal(details, "REVISION_CONFLICT"))).toBeNull();
    expect(agendaConflictDetails(refusal(details, "AGENDA_SCHEDULE_CONFLICT", 500))).toBeNull();
    expect(agendaConflictDetails(new Error("Schedule conflict"))).toBeNull();
  });
  it("shows the attempted owned session and event-zone time without treating every candidate as a cause", async () => {
    const parsed = agendaConflictDetails(refusal(details))!;
    await mount(<AgendaConflictDetails details={parsed} snapshot={snapshot} />);
    expect(host.textContent).toContain("Edited session");
    expect(host.textContent).toContain("Main hall");
    expect(host.textContent).toContain("Europe/Amsterdam");
    expect(host.textContent).toContain("not every session necessarily caused the refusal");
    expect(host.textContent).toContain("Your changes have been kept");
    const textNodes = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const renderedValues: string[] = [];
    while (textNodes.nextNode()) renderedValues.push(textNodes.currentNode.textContent?.trim() ?? "");
    expect(renderedValues).not.toContain(details.proposal.occurrences[0]!.id);
    expect(renderedValues).not.toContain(details.proposal.occurrences[0]!.roomId);
  });
  it("retains an edited session draft after a mounted mutation refusal", async () => {
    const saved = vi.fn();
    const closed = vi.fn();
    const mutations: ReturnType<typeof agendaOccurrencePatchSchema.parse>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        mutations.push(agendaOccurrencePatchSchema.parse(JSON.parse(String(init.body))));
        return new Response(
          JSON.stringify({ error: { code: "AGENDA_SCHEDULE_CONFLICT", message: "Schedule conflict", details } }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }),
    );
    await mount(
      <SessionEditor snapshot={snapshot} occurrence={snapshot.occurrences[0]} onSaved={saved} onClose={closed} />,
    );
    const title = host.querySelector<HTMLInputElement>('input[name="title"]')!;
    await act(() => {
      title.value = "Unsaved edited title";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(host.textContent).toContain("The selected room is already in use"));
    expect(title.value).toBe("Unsaved edited title");
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.title).toBe("Unsaved edited title");
    expect(mutations[0]?.expectedRevision).toBe(snapshot.revision);
    expect(saved).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });
  it("keeps the proposed review after refusal and requires explicit retry before apply", async () => {
    const requests: ReturnType<typeof agendaScheduleProposalSchema.parse>[] = [];
    const saved = vi.fn();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(agendaScheduleProposalSchema.parse(JSON.parse(String(init.body))));
        calls++;
        return new Response(
          JSON.stringify(
            calls === 1
              ? { error: { code: "AGENDA_SCHEDULE_CONFLICT", message: "Schedule conflict", details } }
              : {
                  expectedRevision: 3,
                  reviewHash: "b".repeat(64),
                  affected: [
                    {
                      before: snapshot.occurrences[0],
                      after: {
                        ...snapshot.occurrences[0],
                        startAt: details.proposal.occurrences[0]!.startAt,
                        endAt: details.proposal.occurrences[0]!.endAt,
                      },
                      beforeOrder: 1,
                      afterOrder: 1,
                    },
                  ],
                },
          ),
          { status: calls === 1 ? 409 : 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const attempted = details.proposal.occurrences[0]!;
    const proposal = agendaScheduleProposalSchema.parse({
      expectedRevision: snapshot.revision,
      changes: [{ id: attempted.id, startAt: attempted.startAt, endAt: attempted.endAt, roomId: attempted.roomId }],
    });
    await mount(<AgendaSchedulePreview snapshot={snapshot} proposal={proposal} onSaved={saved} onClose={vi.fn()} />);
    expect(host.textContent).toContain("The selected room is already in use");
    expect(saved).not.toHaveBeenCalled();
    expect(
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Apply reviewed schedule")?.disabled,
    ).toBe(true);
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry schedule review",
    )!;
    await act(() => retry.click());
    await settle();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(host.textContent).not.toContain("Schedule conflict details");
    expect(
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Apply reviewed schedule")?.disabled,
    ).toBe(false);
    expect(saved).not.toHaveBeenCalled();
  });
});
