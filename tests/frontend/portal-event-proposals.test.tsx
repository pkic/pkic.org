// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupEventProposals } from "../../assets/ts/member-flows/portal/sections/management/GroupEventProposals";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
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
    decision_status: null,
    decision_note: null,
    decision_decided_at: null,
    review_count: 0,
    average_review_score: null,
    recommendation_accept_count: 0,
    recommendation_needs_work_count: 0,
    recommendation_reject_count: 0,
  };
}

function stubFetch(calls: string[], detailAccess = access): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("/api/v1/me/proposal-programs")) {
        return json({
          programs: [
            {
              group: { id: GROUP_ID, slug: "working-group", name: "Working Group" },
              event: { id: EVENT_ID, slug: "event", name: "Program Event", startsAt: null },
              access: detailAccess,
            },
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals?`)) {
        return json({
          event: { id: EVENT_ID, slug: "event", name: "Program Event" },
          access: detailAccess,
          proposals: [proposal()],
          stats: {
            byStatus: { submitted: 1 },
            byRecommendation: {},
            reviewedCount: 0,
            unreviewedCount: 1,
            total: 1,
          },
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url === `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}`) {
        return json({
          proposal: { ...proposal(), details: null, canceled_at: null, cancellation_comment: null },
          access: detailAccess,
          form: null,
          minReviewsRequired: 2,
          sessionTypes: [],
        });
      }
      if (url.startsWith(`/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}/audit-log`)) {
        return json({
          auditLog: [
            {
              id: "audit-1",
              created_at: "2026-08-21T12:00:00.000Z",
              actor_type: "admin",
              actor_id: "reviewer-1",
              actor_display: "Reviewer",
              action: "proposal_decision_recorded",
              entity_type: "proposal",
              entity_id: PROPOSAL_ID,
              details: { finalStatus: "accepted" },
            },
          ],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}/reviews`)) {
        return json({
          proposalId: PROPOSAL_ID,
          reviews: [],
          myReview: null,
          summary: {
            totalReviews: 0,
            averageScore: null,
            acceptCount: 0,
            needsWorkCount: 0,
            rejectCount: 0,
            minReviewsRequired: 2,
            quorumMet: false,
          },
          page: { limit: 25, offset: 0, total: 0, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}/comments`)) {
        return json({ comments: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }
      return json({ error: { code: "UNEXPECTED", message: url } }, 500);
    }),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("group event proposal portal", () => {
  it("does not fetch private reviews or comments for a read-only program identity", async () => {
    const calls: string[] = [];
    stubFetch(calls);
    container = document.createElement("div");
    document.body.append(container);
    void act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();

    const row = container.querySelector<HTMLTableRowElement>("tbody tr");
    expect(row).not.toBeNull();
    await act(async () => row?.click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Read-only proposal");
    expect(container.textContent).not.toContain("Reviews");
    expect(calls.some((url) => url.includes("/reviews"))).toBe(false);
    expect(calls.some((url) => url.includes("/comments"))).toBe(false);
    expect(calls.some((url) => url.includes("/audit-log"))).toBe(false);
    expect(calls.some((url) => url.includes("/finalize"))).toBe(false);
  });

  it("shows audit only to reviewers and never renders decision controls without finalize access", async () => {
    const calls: string[] = [];
    stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();
    const row = container.querySelector<HTMLTableRowElement>("tbody tr");
    await act(async () => row?.click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Reviews");
    expect(container.textContent).toContain("Audit log");
    expect(container.textContent).not.toContain("Final decision");
    expect(calls.some((url) => url.includes("/finalize-preview"))).toBe(false);
    expect(calls.some((url) => url.includes("/finalize"))).toBe(false);
    expect(calls.some((url) => url.includes("/audit-log"))).toBe(true);
  });
});
