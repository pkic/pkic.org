// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { ProposalDecisionPanel } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/ProposalDecisionPanel";
import type { ProposalDetailRecord } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/model";

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
  canceled_at: null,
  cancellation_comment: null,
  proposer_email: "proposer@example.test",
  proposer_first_name: "Proposal",
  proposer_last_name: "Owner",
  review_count: 2,
  decision_status: "needs-work",
  decision_note: "Please clarify the implementation plan.",
  decision_decided_at: "2026-08-02T00:00:00.000Z",
  details: null,
};

const editableProposal: ProposalDetailRecord = {
  ...proposal,
  status: "submitted",
  decision_status: null,
  decision_note: null,
  decision_decided_at: null,
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

  it("previews before confirming and finalizing the selected decision", async () => {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        requests.push({ url, method: init?.method ?? "GET", body: init?.body?.toString() ?? null });
        if (url.endsWith("/decisions/previews")) {
          return new Response(
            JSON.stringify({
              success: true,
              recipientCount: 1,
              emailCount: 1,
              layoutMissing: false,
              missingTemplateKeys: [],
              messages: [
                {
                  id: "proposal-decision:user-1",
                  templateKey: "proposal_decision",
                  recipientEmail: "proposer@example.test",
                  recipientLabel: "Proposal Owner",
                  subject: "Proposal update",
                  html: "<p>Accepted</p>",
                  text: "Accepted",
                  templateMissing: false,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            decisionId: "decision-1",
            reviewRound: 1,
            reviewCount: 2,
            minReviewsRequired: 2,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <ProposalDecisionPanel
          proposalId="proposal-1"
          proposal={editableProposal}
          reviewCount={2}
          minReviewsRequired={2}
          loading={false}
          onSaved={() => {}}
        />,
        container!,
      ),
    );

    const select = container.querySelector("select") as HTMLSelectElement;
    await act(() => {
      select.value = "accepted";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const previewButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Preview emails"),
    ) as HTMLButtonElement;
    await act(() => previewButton.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "/api/v1/proposals/proposal-1/decisions/previews",
      method: "POST",
    });
    expect(requests.every(({ url }) => !url.includes("/api/v1/admin/"))).toBe(true);
    expect(container.textContent).toContain("Email preview");
    const recordButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(recordButton.disabled).toBe(true);

    const confirmation = container.querySelector("#proposal-decision-preview-confirm") as HTMLInputElement;
    await act(() => {
      confirmation.checked = true;
      confirmation.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(recordButton.disabled).toBe(false);
    await act(() => recordButton.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      url: "/api/v1/proposals/proposal-1/decisions",
      method: "POST",
    });
    expect(requests.every(({ url }) => !url.includes("/api/v1/admin/"))).toBe(true);
    vi.unstubAllGlobals();
  });
});
