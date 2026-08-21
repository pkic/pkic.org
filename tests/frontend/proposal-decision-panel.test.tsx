// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ProposalDecisionPanel } from "../../assets/ts/admin/sections/events/detail/proposal-detail/ProposalDecisionPanel";
import type { ProposalDetailRecord } from "../../assets/ts/admin/sections/events/detail/proposal-detail/model";

const proposal: ProposalDetailRecord = {
  id: "proposal-1",
  event_id: "event-1",
  proposer_user_id: "user-1",
  status: "needs-work",
  proposal_type: "talk",
  title: "Unanswered proposal",
  abstract: "The proposer has not submitted the requested changes.",
  review_round: 1,
  submitted_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-02T00:00:00.000Z",
  proposer_email: "proposer@example.test",
  proposer_first_name: "Proposal",
  proposer_last_name: "Owner",
  review_count: 2,
  decision_status: "needs-work",
  decision_note: "Please clarify the implementation plan.",
  decision_decided_at: "2026-08-02T00:00:00.000Z",
  details: null,
};

let container: HTMLElement | null = null;

afterEach(() => {
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

describe("proposal decision panel", () => {
  it("offers only administrative rejection after a needs-work decision", () => {
    container = document.createElement("div");
    document.body.append(container);
    void act(() =>
      render(
        <ProposalDecisionPanel
          proposalId={proposal.id}
          proposal={proposal}
          reviewCount={2}
          minReviewsRequired={2}
          loading={false}
          onSaved={() => {}}
        />,
        container!,
      ),
    );

    expect(container.textContent).toContain("Decision recorded:");
    expect(container.textContent).toContain("Please clarify the implementation plan.");
    expect([...container.querySelectorAll("select option")].map((option) => option.getAttribute("value"))).toEqual([
      "",
      "rejected",
    ]);
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain("Record Decision");
  });

  it("keeps an accepted proposal decision read-only", () => {
    container = document.createElement("div");
    document.body.append(container);
    void act(() =>
      render(
        <ProposalDecisionPanel
          proposalId={proposal.id}
          proposal={{ ...proposal, status: "accepted", decision_status: "accepted" }}
          reviewCount={2}
          minReviewsRequired={2}
          loading={false}
          onSaved={() => {}}
        />,
        container!,
      ),
    );

    expect(container.textContent).toContain("Decision recorded:");
    expect(container.querySelector("form")).toBeNull();
  });
});
