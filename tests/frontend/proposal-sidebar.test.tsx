// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ProposalSidebar } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/ProposalSidebar";
import type { ProposalDetailRecord } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/model";
import type { ProposalAccess } from "../../assets/ts/member-flows/portal/sections/events/types";
import { proposalSpeakerReminderRequestSchema } from "../../assets/shared/schemas/proposal-speakers";

const PROPOSAL_ID = "0000000000000000000000000000aaaa";

const proposal: ProposalDetailRecord = {
  id: PROPOSAL_ID,
  event_id: "pqc-conference-amsterdam-nl",
  proposer_user_id: "1111111111111111111111111111bbbb",
  status: "submitted",
  proposal_type: "talk",
  title: "Operational trust in a post-quantum transition",
  abstract: "A migration story.",
  review_round: 1,
  submitted_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
  canceled_at: null,
  cancellation_comment: null,
  proposer_email: "proposer@example.test",
  proposer_first_name: "Proposal",
  proposer_last_name: "Owner",
  review_count: 1,
  decision_status: null,
  decision_note: null,
  decision_decided_at: null,
  details: null,
};

const access: ProposalAccess = {
  eventPermissions: [],
  canRead: true,
  canReview: false,
  canFinalize: true,
  canEditAcceptedAbstract: false,
  canCancelAcceptedProposal: false,
};

let container: HTMLElement | null = null;

function unmount() {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
}

function mount(props: Partial<Parameters<typeof ProposalSidebar>[0]> = {}) {
  unmount();
  container = document.createElement("div");
  document.body.append(container);
  void act(() =>
    render(
      <ProposalSidebar
        proposal={proposal}
        proposalId={PROPOSAL_ID}
        access={access}
        proposalRequiresPresentation={false}
        loading={false}
        reviewCount={1}
        minReviewsRequired={2}
        quorumMet={false}
        averageScore={3.5}
        recommendationCounts={{ accept: 1, "needs-work": 0, reject: 0 }}
        commentDraft=""
        savingComment={false}
        comments={[]}
        commentsPage={null}
        loadingMoreComments={false}
        onCommentDraftChange={() => {}}
        onAddComment={async () => {}}
        onLoadMoreComments={async () => {}}
        onOpenManage={async () => {}}
        onFlag={async () => {}}
        {...props}
      />,
      container!,
    ),
  );
  return container!;
}

function buttonNamed(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLButtonElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  unmount();
});

describe("proposal sidebar", () => {
  it("pairs every status value with the term that names it", () => {
    const root = mount();

    const list = root.querySelector("dl.pk-datalist") as HTMLElement;
    expect([...list.querySelectorAll(":scope > dt")].map((dt) => dt.textContent)).toEqual([
      "Workflow status",
      "Decision",
      "Reviews",
      "Last updated",
    ]);
    const values = [...list.querySelectorAll(":scope > dd")];
    expect(values).toHaveLength(4);
    expect(values[1].textContent).toBe("Pending");
    // The quorum verdict is a sentence, not a colour: the tone repeats it
    // rather than being the only thing that carries it.
    expect(values[2].textContent).toContain("1 / 2 required");
    expect(values[2].textContent).toContain("Quorum not met");
    expect(values[2].querySelector(".pk-badge--warn")?.textContent).toBe("Quorum not met");
    expect(values[2].textContent).toContain("Avg score 3.5");
    expect(values[2].textContent).toContain("Accept 1");
  });

  it("says quorum is met in words when it is", () => {
    const root = mount({ quorumMet: true, reviewCount: 2 });

    const badge = root.querySelector(".pk-badge--ok") as HTMLElement;
    expect(badge.textContent).toBe("Quorum met");
  });

  it("keeps the operator panel behind the finalize permission", () => {
    const root = mount({ access: { ...access, canFinalize: false } });

    expect([...root.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual(["Status"]);
    expect(root.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("names the operator actions and reaches the proposer through a real link", () => {
    const root = mount();

    expect([...root.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      "Operator actions",
      "Status",
    ]);
    // Emailing the proposer is a navigation, so it is an anchor a keyboard and
    // a screen reader can treat as one — not a button styled to look like a
    // link, and not a click handler on a div.
    const mailto = root.querySelector('a[href^="mailto:"]') as HTMLAnchorElement;
    expect(mailto.getAttribute("href")).toBe("mailto:proposer@example.test");
    expect(mailto.textContent?.trim()).toBe("Email proposer");
    expect(mailto.className).toContain("pk-btn");

    // A moderation verdict that has already been applied says so in its label,
    // as well as being disabled.
    const spamRoot = mount({ proposal: { ...proposal, status: "spam" } });
    expect(buttonNamed(spamRoot, "Marked as spam").disabled).toBe(true);
    expect(buttonNamed(spamRoot, "Mark as duplicate").disabled).toBe(false);
  });

  it("offers the presentation reminder only for an accepted proposal that needs one", () => {
    const label = "Remind all speakers to upload their presentation";
    expect(() => buttonNamed(mount(), label)).toThrow();

    const accepted = { ...proposal, decision_status: "accepted" as const };
    expect(() => buttonNamed(mount({ proposal: accepted }), label)).toThrow();

    const root = mount({ proposal: accepted, proposalRequiresPresentation: true });
    expect(buttonNamed(root, label)).toBeTruthy();
  });

  it("sends the reminder the shared request schema describes", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), body: init?.body?.toString() ?? "" });
        return new Response(JSON.stringify({ success: true, queued: 3 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const root = mount();

    await act(() => buttonNamed(root, "Remind all speakers to complete their profile").click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/api/v1/proposals/${PROPOSAL_ID}/speakers/reminders`);
    // The contract, not a literal: the body has to satisfy the schema the
    // endpoint validates against.
    expect(proposalSpeakerReminderRequestSchema.parse(JSON.parse(calls[0].body))).toEqual({ kind: "profile" });
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("states a refused reminder in a live region instead of only a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "You cannot remind these speakers." } }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const root = mount();

    await act(() => buttonNamed(root, "Remind all speakers to complete their profile").click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const alert = root.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("You cannot remind these speakers.");
  });
});
