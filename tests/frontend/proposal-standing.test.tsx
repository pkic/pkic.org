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
    expect(terms).toEqual([
      "Workflow status",
      "Decision",
      "Reviews",
      "Average score",
      "Recommendations",
      "Decided",
      "Last updated",
    ]);
    const values = [...list.querySelectorAll(":scope > dd")];
    expect(values[1].textContent).toBe("Pending");
    expect(values[2].textContent).toContain("1 of 2 required");
    expect(values[2].querySelector(".pk-badge--warn")?.textContent).toBe("Quorum not met");
    expect(values[3].textContent).toBe("3.5");
    expect(values[4].textContent).toContain("Accept 1");
    // A fact the record does not have is a dash, not a blank.
    expect(values[5].textContent).toBe("—");
  });

  it("says quorum is met in words when it is", () => {
    const root = mount({ quorumMet: true, reviewCount: 2 });
    expect(root.querySelector(".pk-badge--ok")?.textContent).toBe("Quorum met");
  });
});
