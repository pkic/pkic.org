// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { AcceptedProposalCancellationPanel } from "../../assets/ts/components/proposals/AcceptedProposalCancellationPanel";
import {
  ProposalReviewsPanel,
  type ProposalReviewDraft,
} from "../../assets/ts/components/proposals/ProposalReviewsPanel";
import { ProposalReviewCard } from "../../assets/ts/components/proposals/ProposalReviewCard";
import { GroupEventProposals } from "../../assets/ts/member-flows/portal/sections/management/GroupEventProposals";
import { ProposalCoSpeakerInviteForm } from "../../assets/ts/components/proposals/ProposalCoSpeakerInviteForm";
import { coSpeakerInviteSchema } from "../../assets/shared/schemas/proposal-management";
import { proposalReviewUpsertSchema, type ProposalReview } from "../../assets/shared/schemas/proposal-reviews";
import { buttonNamed, chooseOption, controlFor, labelNames, typeInto } from "./helpers/labelled-control";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", vi.fn()],
}));

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

describe("one review card", () => {
  it("names the card after its reviewer so a column of them can be navigated", () => {
    const root = mount(<ProposalReviewCard review={review} />);

    // An unnamed <section> is not exposed as a region at all, which is what a
    // column of review cards used to be: one undifferentiated run of text.
    const card = root.querySelector("section");
    expect(card?.getAttribute("aria-label")).toBe("Review by Review Owner");
  });

  it("states the recommendation and the score in words, not in colour", () => {
    const root = mount(<ProposalReviewCard review={review} />);

    // Roughly one man in twelve cannot separate the accept and reject hues, so
    // the badge's tone is never the only thing carrying the recommendation.
    expect(root.textContent).toContain("Accept");
    expect(root.textContent).toContain("Score 9/10");
  });

  it("falls back to an identifier when the reviewer record carries no name", () => {
    const root = mount(
      <ProposalReviewCard
        review={{ ...review, reviewer_first_name: null, reviewer_last_name: null, reviewer_email: null }}
      />,
    );

    // A review with an incomplete reviewer record still has to say whose it is
    // rather than rendering an empty byline and an unnamed region.
    expect(root.textContent).toContain("reviewer-1");
    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Review by reviewer-1");
  });

  it("omits both note blocks when the review carries neither", () => {
    const root = mount(<ProposalReviewCard review={{ ...review, reviewer_comment: null, applicant_note: null }} />);

    expect(root.textContent).not.toContain("Internal review notes");
    expect(root.textContent).not.toContain("Suggested note to applicant");
  });

  it("labels the applicant draft rather than distinguishing it by tint alone", () => {
    const root = mount(<ProposalReviewCard review={{ ...review, applicant_note: "Please shorten the abstract." }} />);

    expect(root.textContent).toContain("Suggested note to applicant");
    expect(root.textContent).toContain("Please shorten the abstract.");
  });
});

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

  it("submits the reviewer's draft as the shared upsert contract", async () => {
    const onSave = vi.fn(async (_draft: ProposalReviewDraft) => review);
    const onSaved = vi.fn();
    const root = mount(reviewPanel({ canReview: true, onSave, onSaved }));

    await chooseOption(controlFor<HTMLSelectElement>(root, "Recommendation"), "needs-work");
    await typeInto(controlFor(root, "Score (1–10)"), "7");
    await typeInto(controlFor<HTMLTextAreaElement>(root, "Internal review notes"), "  Needs a tighter scope.  ");
    await act(async () => {
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Parsed through the canonical schema instead of compared to a literal, so
    // the assertion breaks if the draft stops being a valid upsert.
    expect(proposalReviewUpsertSchema.parse(onSave.mock.calls[0][0])).toEqual({
      recommendation: "needs-work",
      score: 7,
      reviewerComment: "Needs a tighter scope.",
      applicantNote: undefined,
    });
    expect(onSaved).toHaveBeenCalledWith(review);
  });

  it("states a failed save on the surface and keeps the draft", async () => {
    const onError = vi.fn();
    const onSaved = vi.fn();
    const root = mount(
      reviewPanel({
        canReview: true,
        onSaved,
        onError,
        onSave: async () => {
          throw new Error("Score must be between 1 and 10.");
        },
      }),
    );

    await typeInto(controlFor(root, "Score (1–10)"), "9");
    await act(async () => {
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // A toast can be gone before the reviewer looks up; the form must say so
    // itself, and must not discard what was typed.
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Score must be between 1 and 10.");
    expect(onError).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
    expect(controlFor(root, "Score (1–10)").value).toBe("9");
    expect(buttonNamed(root, "Submit Review").disabled).toBe(false);
  });

  it("names every review control and says quorum in words as well as tone", () => {
    const root = mount(reviewPanel({ canReview: true }));

    expect(labelNames(root)).toEqual([
      "Recommendation",
      "Score (1–10)",
      "Internal review notes",
      "Suggested note to applicant",
    ]);
    // Each label resolves to a real control through its own for/id pair.
    expect(controlFor<HTMLSelectElement>(root, "Recommendation").tagName).toBe("SELECT");
    expect(controlFor(root, "Score (1–10)").required).toBe(true);
    // One man in twelve cannot separate the warn and ok hues, so the count is
    // spelled out rather than left to the badge's colour.
    expect(root.textContent).toContain("1 more review needed");
  });

  it("offers more reviews through a real button rather than a clickable row", async () => {
    const onLoadMore = vi.fn(async () => {});
    const root = mount(reviewPanel({ page: { limit: 25, offset: 0, total: 30, hasMore: true }, onLoadMore }));

    const more = buttonNamed(root, "Load more reviews");
    await act(async () => more.click());
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("names the empty review list instead of leaving the region blank", () => {
    const root = mount(reviewPanel({ reviews: [], summary: { ...summary, totalReviews: 0 } }));

    const status = root.querySelector('[role="status"]');
    expect(status?.textContent).toContain("No reviews yet");
    expect(root.textContent).toContain("2 more reviews needed");
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

  it("names the comment control, draws a real checkbox, and states the consequences in words", () => {
    const root = mount(
      <AcceptedProposalCancellationPanel
        proposal={{ status: "accepted", canceled_at: null, cancellation_comment: null }}
        canCancel
        onCancel={async () => ({ notifiedSpeakerCount: 0 })}
        onCanceled={() => {}}
        onError={() => {}}
      />,
    );

    // The textarea is reached through the label's `for` and the control's
    // `id`, which is the pair that names it to a reader.
    expect(labelNames(root)).toContain("Comment to speakers");
    expect(controlFor<HTMLTextAreaElement>(root, "Comment to speakers").required).toBe(true);

    // All three check parts, or the browser draws its own control: the block
    // on the label, the input class, and the label class.
    const check = root.querySelector("label.pk-check")!;
    expect(check.querySelector("input.pk-check__input")).not.toBeNull();
    expect(check.querySelector(".pk-check__label")?.textContent).toContain("every speaker linked to this proposal");

    // The red border used to be the only thing saying this was destructive.
    // The consequences are stated, and announced, instead.
    const warning = root.querySelector('[role="alert"]');
    expect(warning?.textContent).toContain("emails every speaker");
  });

  it("hands a failed cancellation to its caller and leaves the form usable", async () => {
    const failure = new Error("The proposal is no longer accepted.");
    const onError = vi.fn();
    const onCanceled = vi.fn();
    const root = mount(
      <AcceptedProposalCancellationPanel
        proposal={{ status: "accepted", canceled_at: null, cancellation_comment: null }}
        canCancel
        onCancel={() => Promise.reject(failure)}
        onCanceled={onCanceled}
        onError={onError}
      />,
    );

    const comment = controlFor<HTMLTextAreaElement>(root, "Comment to speakers");
    const confirmation = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      comment.value = "Speaker unavailable";
      comment.dispatchEvent(new Event("input", { bubbles: true }));
      confirmation.checked = true;
      confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith(failure);
    expect(onCanceled).not.toHaveBeenCalled();
    const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    expect(submit?.hasAttribute("aria-busy")).toBe(false);
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
        const body = url.includes("/proposals/programs")
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

  it("queues a canonical co-speaker invitation with the selected role and bounded deadline", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const onInvited = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              email: "speaker@example.test",
              role: "panelist",
              expiresAt: "2027-01-01T12:00:00.000Z",
              queued: true,
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );
    const root = mount(
      <ProposalCoSpeakerInviteForm
        endpoint="/api/v1/proposals/proposal-1/speakers"
        proposalId="proposal-1"
        event={{ startsAt: "2027-01-01T09:00:00.000Z", endsAt: "2027-01-01T17:00:00.000Z", timezone: "UTC" }}
        onInvited={onInvited}
      />,
    );

    const email = root.querySelector<HTMLInputElement>('input[type="email"]')!;
    const role = root.querySelector<HTMLSelectElement>("select")!;
    const deadline = root.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(deadline.max).toBe("2027-01-01T17:00");
    await act(() => {
      email.value = "SPEAKER@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      role.value = "panelist";
      role.dispatchEvent(new Event("change", { bubbles: true }));
      deadline.value = "2027-01-01T12:00";
      deadline.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/proposals/proposal-1/speakers");
    expect(requests[0].url).not.toContain("/api/v1/admin");
    // Parsed through the shared request schema rather than compared to a
    // literal, so the case follows the contract as it moves.
    const invited = coSpeakerInviteSchema.parse(JSON.parse(String(requests[0].init?.body)));
    expect(invited.email).toBe("speaker@example.test");
    expect(invited.role).toBe("panelist");
    expect(invited.expiresAt).toBe("2027-01-01T12:00:00.000Z");
    expect(onInvited).toHaveBeenCalledOnce();
    expect(email.value).toBe("");
  });

  it("pairs every co-speaker label with its control and names the set", () => {
    const root = mount(
      <ProposalCoSpeakerInviteForm
        endpoint="/api/v1/proposals/proposal-1/speakers"
        proposalId="proposal-1"
        event={{ startsAt: "2027-01-01T09:00:00.000Z", endsAt: "2027-01-01T17:00:00.000Z", timezone: "UTC" }}
        onInvited={vi.fn()}
      />,
    );

    // The legend names the group, so the five controls are announced as one
    // question rather than as loose inputs after a styled heading.
    expect(root.querySelector("fieldset > legend")?.textContent).toBe("Invite a co-speaker");
    expect(root.querySelector("form")?.id).toBe("proposal-proposal-1-speaker-invite");

    const labels = [...root.querySelectorAll<HTMLLabelElement>("label.pk-field__label")];
    expect(labels.map((label) => label.textContent?.replace(/\*\(required\)$/, ""))).toEqual([
      "Email address",
      "First name",
      "Last name",
      "Proposal role",
      "Invitation deadline",
    ]);
    for (const label of labels) {
      // Every label points at a control that actually exists.
      expect(root.querySelector(`#${label.htmlFor}`)).not.toBeNull();
    }

    const email = root.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email?.required).toBe(true);

    // The deadline's rule is tied to the control, not a sentence beside it.
    const deadline = root.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    const describedBy = deadline?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(root.querySelector(`#${describedBy ?? ""}`)?.textContent).toContain("cannot be later than the event end");
  });

  it("states a rejected invitation and takes the controls out of play while it is in flight", async () => {
    // Captured through a holder rather than a bare `let`, so the assignment
    // inside the executor is visible to the type checker.
    const held: { release: (() => void) | null } = { release: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            held.release = () =>
              resolve(
                new Response(JSON.stringify({ error: { code: "conflict", message: "Already invited." } }), {
                  status: 409,
                  headers: { "content-type": "application/json" },
                }),
              );
          }),
      ),
    );
    const notify = vi.fn();
    const onInvited = vi.fn();
    const root = mount(
      <ProposalCoSpeakerInviteForm
        endpoint="/api/v1/proposals/proposal-1/speakers"
        proposalId="proposal-1"
        event={{ startsAt: "2027-01-01T09:00:00.000Z", endsAt: "2027-01-01T17:00:00.000Z", timezone: "UTC" }}
        notify={notify}
        onInvited={onInvited}
      />,
    );

    const email = root.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(() => {
      email.value = "speaker@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    // One attribute takes the whole set out of play, and the submit stays
    // focusable so a screen-reader user is not thrown out of the form.
    expect(root.querySelector("fieldset")?.disabled).toBe(true);
    const submit = root.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.getAttribute("aria-busy")).toBe("true");

    held.release?.();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Already invited.");
    expect(notify).toHaveBeenCalledWith("Already invited.", "error");
    expect(onInvited).not.toHaveBeenCalled();
    expect(root.querySelector("fieldset")?.disabled).toBe(false);
  });
});
