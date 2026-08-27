// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { AcceptedProposalCancellationPanel } from "../../assets/ts/components/proposals/AcceptedProposalCancellationPanel";
import { ProposalReviewsPanel } from "../../assets/ts/components/proposals/ProposalReviewsPanel";
import { GroupEventProposals } from "../../assets/ts/member-flows/portal/sections/management/GroupEventProposals";
import type { ProposalReview } from "../../assets/shared/schemas/proposal-reviews";

let container: HTMLElement | null = null;

afterEach(() => {
  vi.unstubAllGlobals();
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

const review: ProposalReview = {
  id: "review-1",
  proposal_id: "proposal-1",
  reviewer_user_id: "reviewer-1",
  recommendation: "accept",
  review_round: 1,
  score: 9,
  reviewer_comment: "Strong proposal.",
  applicant_note: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  reviewer_email: "reviewer@example.test",
  reviewer_first_name: "Review",
  reviewer_last_name: "Owner",
};

const summary = {
  totalReviews: 1,
  averageScore: 9,
  acceptCount: 1,
  needsWorkCount: 0,
  rejectCount: 0,
  minReviewsRequired: 2,
  quorumMet: false,
};

function reviewPanel(overrides: Partial<Parameters<typeof ProposalReviewsPanel>[0]> = {}) {
  return (
    <ProposalReviewsPanel
      loading={false}
      reviews={[review]}
      page={{ limit: 25, offset: 0, total: 1, hasMore: false }}
      summary={summary}
      minReviewsRequired={2}
      canReview={false}
      reviewLocked={false}
      myReview={null}
      loadingMore={false}
      onLoadMore={async () => {}}
      onSave={async () => review}
      onSaved={() => {}}
      onError={() => {}}
      {...overrides}
    />
  );
}

describe("shared proposal management components", () => {
  it("shows review content without exposing a write form to non-reviewers", () => {
    const root = mount(reviewPanel());

    expect(root.textContent).toContain("Strong proposal.");
    expect(root.textContent).not.toContain("Add Review");
    expect(root.querySelector("form")).toBeNull();
  });

  it("exposes only the authenticated reviewer's own review form when unlocked", () => {
    const root = mount(reviewPanel({ canReview: true, myReview: review }));

    expect(root.textContent).toContain("Edit My Review");
    expect(root.querySelector("form")).not.toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Strong proposal.");
  });

  it("keeps reviewer writes hidden after a decision", () => {
    const root = mount(reviewPanel({ canReview: true, reviewLocked: true }));

    expect(root.textContent).toContain("Reviews are read-only after a proposal decision.");
    expect(root.querySelector("form")).toBeNull();
  });

  it("requires a cancellation comment and explicit confirmation", async () => {
    const onCancel = vi.fn(async () => ({ notifiedSpeakerCount: 2 }));
    const onCanceled = vi.fn();
    const root = mount(
      <AcceptedProposalCancellationPanel
        proposal={{ status: "accepted", canceled_at: null, cancellation_comment: null }}
        canCancel
        onCancel={onCancel}
        onCanceled={onCanceled}
        onError={() => {}}
      />,
    );

    const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(true);
    const comment = root.querySelector<HTMLTextAreaElement>("textarea")!;
    const confirmation = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      comment.value = "Speaker unavailable";
      comment.dispatchEvent(new Event("input", { bubbles: true }));
      confirmation.checked = true;
      confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(submit?.disabled).toBe(false);
    await act(async () => {
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onCancel).toHaveBeenCalledWith("Speaker unavailable");
    expect(onCanceled).toHaveBeenCalledWith(2);
  });

  it("renders cancellation history without showing a second mutation form", () => {
    const root = mount(
      <AcceptedProposalCancellationPanel
        proposal={{
          status: "canceled",
          canceled_at: "2026-08-03T00:00:00.000Z",
          cancellation_comment: "Speaker unavailable",
        }}
        canCancel
        onCancel={async () => ({ notifiedSpeakerCount: 0 })}
        onCanceled={() => {}}
        onError={() => {}}
      />,
    );

    expect(root.textContent).toContain("Session canceled");
    expect(root.textContent).toContain("Speaker unavailable");
    expect(root.querySelector("form")).toBeNull();
  });

  it("keeps a read-only proposal program from fetching reviews or comments", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        const body = url.includes("/me/proposal-programs")
          ? {
              programs: [
                {
                  group: { id: "group-1", slug: "group-1", name: "Group One" },
                  event: { id: "event-1", slug: "event-1", name: "Event One" },
                  access: {
                    eventPermissions: ["proposals:read"],
                    canRead: true,
                    canReview: false,
                    canFinalize: false,
                    canEditAcceptedAbstract: false,
                    canCancelAcceptedProposal: false,
                  },
                },
              ],
              page: { limit: 50, offset: 0, total: 1, hasMore: false },
            }
          : {
              event: { id: "event-1", slug: "event-1", name: "Event One" },
              access: {
                eventPermissions: ["proposals:read"],
                canRead: true,
                canReview: false,
                canFinalize: false,
                canEditAcceptedAbstract: false,
                canCancelAcceptedProposal: false,
              },
              proposals: [],
              page: { limit: 50, offset: 0, total: 0, hasMore: false },
              stats: { byStatus: {}, byRecommendation: {}, reviewedCount: 0, unreviewedCount: 0, total: 0 },
            };
        return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
      }),
    );

    mount(<GroupEventProposals groupId="group-1" eventId="event-1" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(requests.some((url) => url.includes("/reviews") || url.includes("/comments"))).toBe(false);
  });
});
