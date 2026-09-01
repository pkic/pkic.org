// @vitest-environment jsdom
/**
 * The shared proposal catalog — the filters above it, the statistics beside
 * it, and the panel a group's event workspace opens it in.
 *
 * What a screenshot cannot check: that the statistics say in words which
 * numbers matter rather than tinting two of them green and amber, that the
 * table and every filter carry a name, and what the surface says when the
 * program behind it is gone or refused.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupEventProposals } from "../../assets/ts/member-flows/portal/sections/management/GroupEventProposals";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const EVENT_SLUG = "event";
const PROPOSAL_ID = "30000000-0000-4000-8000-000000000001";

let container: HTMLElement | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const access = {
  eventPermissions: ["proposals:read"],
  canRead: true,
  canReview: false,
  canFinalize: false,
  canEditAcceptedAbstract: false,
  canCancelAcceptedProposal: false,
};

function proposal() {
  return {
    id: PROPOSAL_ID,
    event_id: EVENT_ID,
    proposer_user_id: "40000000-0000-4000-8000-000000000001",
    status: "submitted",
    proposal_type: "talk",
    title: "Read-only proposal",
    abstract: "A sufficiently long abstract for the program committee detail view.",
    review_round: 1,
    submitted_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    proposer_email: "proposer@example.test",
    proposer_first_name: "Proposal",
    proposer_last_name: "Owner",
    decision_status: "accepted",
    decision_note: null,
    decision_decided_at: null,
    review_count: 0,
    average_review_score: null,
    recommendation_accept_count: 0,
    recommendation_needs_work_count: 0,
    recommendation_reject_count: 0,
  };
}

/** The program lookup and the proposal page, as the two endpoints answer them. */
function stubCatalog(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/v1/proposals/programs")) {
        return json({
          programs: [
            {
              group: { id: GROUP_ID, slug: "working-group", name: "Working Group" },
              event: { id: EVENT_ID, slug: EVENT_SLUG, name: "Program Event", startsAt: null },
              access,
            },
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        });
      }
      return json({
        event: { id: EVENT_ID, slug: EVENT_SLUG, name: "Program Event" },
        access,
        proposals: [proposal()],
        stats: { byStatus: { submitted: 1 }, byRecommendation: {}, reviewedCount: 0, unreviewedCount: 1, total: 1 },
        page: { limit: 25, offset: 0, total: 1, hasMore: false },
      });
    }),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mountCatalog(eventSlug?: string): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(() =>
    render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} eventSlug={eventSlug} />, container!),
  );
  await settle();
  await settle();
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("the shared proposal catalog", () => {
  it("states the proposal statistics in words and names the group they form", async () => {
    stubCatalog();

    const page = await mountCatalog(EVENT_SLUG);

    // The counts were tinted green and amber, which was the only thing saying
    // which of them mattered. The label beside each number says it instead.
    const summary = page.querySelector('[role="group"][aria-label="Proposal statistics"]')!;
    expect(summary).not.toBeNull();
    expect(summary.textContent).toContain("1 submitted");
    expect(summary.textContent).toContain("1 no reviews");
    expect(summary.querySelector(".text-success, .text-warning")).toBeNull();

    // The section is a named panel, and the table inside it names itself.
    expect(page.querySelector('[aria-label="Proposal program"]')).not.toBeNull();
    expect(page.querySelector("h4")?.textContent).toBe("Proposal program");
    expect(page.querySelector("caption")?.textContent).toBe("Event proposals");
    // Every proposal filter carries a name, even without room for a visible one.
    const filterNames = Array.from(page.querySelectorAll("select")).map((select) => select.getAttribute("aria-label"));
    expect(filterNames).toEqual(
      expect.arrayContaining(["Proposal status", "Review recommendation", "Proposal archive"]),
    );
  });

  it("sends the archive choice to the proposals query rather than filtering rows in the browser", async () => {
    stubCatalog();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    const page = await mountCatalog(EVENT_SLUG);

    const archive = page.querySelector<HTMLSelectElement>('select[aria-label="Proposal archive"]')!;
    expect(archive).not.toBeNull();
    // The default view is the server default: no `archived` parameter at all.
    const before = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(before.some((url) => url.includes("archived="))).toBe(false);

    archive.value = "true";
    await act(async () => {
      archive.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const requested = fetchMock.mock.calls.map((call) => new URL(String(call[0]), location.origin));
    expect(requested.some((url) => url.searchParams.get("archived") === "true")).toBe(true);
    sessionStorage.clear();
  });

  it("states an unavailable proposal program as a status region rather than a bare line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ programs: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })),
    );

    const page = await mountCatalog();

    const status = page.querySelector('[role="status"].pk-empty-state');
    expect(status?.textContent).toContain("This proposal program is not available.");
    expect(page.querySelector("table")).toBeNull();
  });

  it("states a refused proposal program lookup as a sentence, not as a status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "no" }, 403)),
    );

    const page = await mountCatalog();

    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(alert?.textContent).not.toContain("HTTP 403");
  });
});
