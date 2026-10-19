// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ProposalStanding } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/ProposalStanding";
import type { ProposalDetailRecord } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/model";

const proposal: ProposalDetailRecord = {
  id: "0000000000000000000000000000aaaa",
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
  committee_notes: null,
  proposer_email: "proposer@example.test",
  proposer_first_name: "Proposal",
  proposer_last_name: "Owner",
  review_count: 1,
  decision_status: null,
  decision_note: null,
  decision_decided_at: null,
  details: null,
};

let container: HTMLElement | null = null;

function unmount() {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
}

function mount(props: Partial<Parameters<typeof ProposalStanding>[0]> = {}) {
  unmount();
  container = document.createElement("div");
  document.body.append(container);
  void act(() =>
    render(
      <ProposalStanding
        proposal={proposal}
        loading={false}
        reviewCount={1}
        minReviewsRequired={2}
        quorumMet={false}
        averageScore={3.5}
        recommendationCounts={{ accept: 1, "needs-work": 0, reject: 0 }}
        {...props}
      />,
      container!,
    ),
  );
  return container!;
}

afterEach(unmount);

/**
 * The committee's standing beside the proposal: the facts a reviewer glances
 * at while reading any facet. It replaced a "Status" panel and a sidebar of
 * block buttons; what a screenshot cannot check is that every value keeps
 * the term that names it and that the quorum verdict is words, not a tint.
 */
describe("proposal review standing", () => {
  it("pairs every value with the term that names it, and states quorum in words", () => {
    const root = mount();

    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Review standing");
    const list = root.querySelector("dl.pk-datalist") as HTMLElement;
    const terms = [...list.querySelectorAll(":scope > dt")].map((dt) => dt.textContent);
    expect(terms).toEqual(["Status", "Reviews", "Average score", "Recommendations", "Decided", "Last updated"]);
    const values = [...list.querySelectorAll(":scope > dd")];
    expect(values[1].textContent).toContain("1 review (2 required)");
    // Falling short of quorum is the one fact that asks for something: a mark, not a pill.
    expect(values[1].querySelector(".pk-attention-mark")?.textContent).toBe("Quorum not met");
    expect(list.querySelector(".pk-badge")).toBeNull();
    expect(values[2].textContent).toBe("3.5");
    expect(values[3].textContent).toBe("Accept 1");
    // A fact the record does not have is a dash, not a blank.
    expect(values[4].textContent).toBe("—");
  });

  it("states one status when the decision says the same thing, and the decision only when it differs", () => {
    const decided = mount({ proposal: { ...proposal, status: "accepted", decision_status: "accepted" } });
    const terms = () => [...decided.querySelectorAll("dl.pk-datalist > dt")].map((dt) => dt.textContent);
    expect(terms()).not.toContain("Decision");
    expect(decided.textContent?.match(/Accepted/g)).toHaveLength(1);

    const pending = mount({ proposal: { ...proposal, status: "under_review", decision_status: "accepted" } });
    expect([...pending.querySelectorAll("dl.pk-datalist > dt")].map((dt) => dt.textContent)).toContain("Decision");
  });

  it("counts reviews before the threshold they are measured against", () => {
    const root = mount({ quorumMet: true, reviewCount: 3 });
    expect(root.textContent).toContain("3 reviews (2 required)");
  });

  it("says quorum is met in words when it is", () => {
    const root = mount({ quorumMet: true, reviewCount: 2 });
    const reviews = [...root.querySelectorAll("dl.pk-datalist > dt")].find(
      (term) => term.textContent === "Reviews",
    )?.nextElementSibling;
    expect(reviews?.textContent).toContain("Quorum met");
    expect(reviews?.querySelector(".pk-attention-mark, .pk-badge")).toBeNull();
  });

  it("states status and recommendations as plain text", () => {
    const root = mount({
      proposal: { ...proposal, status: "accepted", decision_status: "accepted" },
      quorumMet: true,
      reviewCount: 6,
      recommendationCounts: { accept: 2, "needs-work": 4, reject: 0 },
    });
    expect(root.querySelector(".pk-badge")).toBeNull();
    const values = [...root.querySelectorAll("dl.pk-datalist > dd")].map((dd) => dd.textContent);
    expect(values[0]).toBe("Accepted");
    expect(values).toContain("Accept 2, Needs work 4");
  });
});
