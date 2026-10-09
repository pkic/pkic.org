import { runRowAction, rowActionIsDisabled } from "./helpers/row-actions";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptedProposalBacklog } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AcceptedProposalBacklog";
import {
  eventProposalsListQuerySchema,
  eventProposalsResponseSchema,
} from "../../assets/shared/schemas/event-proposals";
const eventId = "10000000-0000-4000-8000-000000000001",
  proposerId = "20000000-0000-4000-8000-000000000001";
const ids = ["30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000002"];
function proposal(index: number) {
  return {
    id: ids[index],
    event_id: eventId,
    proposer_user_id: proposerId,
    status: "accepted",
    proposal_type: "talk",
    title: `Accepted session ${index + 1}`,
    abstract: "Reviewed proposal source",
    review_round: 1,
    submitted_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-02T10:00:00.000Z",
    proposer_email: "source@example.test",
    proposer_first_name: "Synthetic",
    proposer_last_name: "Presenter",
    decision_status: "accepted",
    decision_note: null,
    decision_decided_at: null,
    review_count: 1,
    average_review_score: null,
    recommendation_accept_count: 1,
    recommendation_needs_work_count: 0,
    recommendation_reject_count: 0,
    has_presentation: false,
    agendaImported: false,
  };
}
function response(
  proposals: ReturnType<typeof proposal>[],
  limit: number,
  offset: number,
  total: number,
  canRead = true,
) {
  return eventProposalsResponseSchema.parse({
    event: { id: eventId, slug: "synthetic", name: "Synthetic event" },
    access: {
      eventPermissions: ["proposals:read"],
      canRead,
      canReview: false,
      canFinalize: false,
      canEditAcceptedAbstract: false,
      canCancelAcceptedProposal: false,
    },
    proposals,
    stats: { byStatus: { accepted: total }, byRecommendation: {}, reviewedCount: total, unreviewedCount: 0, total },
    page: { limit, offset, total, hasMore: offset + proposals.length < total },
  });
}
let host: HTMLElement;
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(onAdd = vi.fn()) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<AcceptedProposalBacklog eventSlug="synthetic" onReview={vi.fn()} onAdd={onAdd} />, host));
  await settle();
  await settle();
  return onAdd;
}
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  history.replaceState(null, "", location.pathname);
});
describe("Accepted proposal agenda backlog", () => {
  it("uses accepted-only canonical server search/pagination and requests adding an unimported proposal without writing", async () => {
    const requests: URL[] = [];
    location.hash = "/events/synthetic/agenda?accepted-backlog.f.status=rejected";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method ?? "GET").toBe("GET");
        const url = new URL(String(input), "https://example.test");
        requests.push(url);
        const query = eventProposalsListQuerySchema.parse(Object.fromEntries(url.searchParams));
        expect(query.status).toBe("accepted");
        expect(query.agenda).toBe("unimported");
        return Response.json(response([proposal(1)], query.limit, query.offset, query.limit + 1));
      }),
    );
    const onAdd = await mount(vi.fn());
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector('section[aria-label="Accepted proposals"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Accepted session 1");
    expect(host.querySelector(`[aria-label="Place in next free slot, Accepted session 1"]`)).toBeNull();
    await runRowAction(host, "Accepted session 2", "Place in next free slot");
    expect(onAdd).toHaveBeenCalledWith([ids[1]]);
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(() => {
      search.value = "Synthetic presenter";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("Synthetic presenter");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!;
    expect(next).not.toBeNull();
    await act(() => next.click());
    await settle();
    const query = eventProposalsListQuerySchema.parse(Object.fromEntries(requests.at(-1)!.searchParams));
    expect(query.offset).toBe(query.limit);
    expect(query.q).toBe("Synthetic presenter");
    expect(query.status).toBe("accepted");
  });
  it("does not enable the add action when the source catalogue denies read access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(response([proposal(1)], 25, 0, 1, false))),
    );
    const onAdd = await mount();
    expect(await rowActionIsDisabled(host, "Accepted session 2", "Place in next free slot")).toBe(true);
    expect(onAdd).not.toHaveBeenCalled();
    expect(host.querySelector("form")).toBeNull();
  });
  it("shows the canonical empty state without exposing an edit form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(response([], 25, 0, 0))),
    );
    await mount();
    expect(host.textContent).toContain("No accepted proposals match this search.");
    expect(host.querySelector("form")).toBeNull();
    expect(
      [...host.querySelectorAll("button")].some((button) => button.textContent === "Place in next free slot"),
    ).toBe(false);
  });
});
