// @vitest-environment jsdom
/**
 * How a closed vote reads back.
 *
 * The Bootstrap version signalled the outcome twice over with colour — a green
 * `text-bg-success` pill for the winner, `text-success`/`text-info` numbers in
 * the motion tally — and left the per-round tallies as a stack of unnamed
 * lists. What is asserted here is what a visual review cannot see: that every
 * outcome is stated in words as well as tone, that each round names its own
 * list, and that a result with nothing in it renders rather than throwing.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import {
  electionVoteResultSchema,
  motionVoteResultSchema,
  candidateSummarySchema,
} from "../../assets/shared/schemas/votes";
import { ElectionResultView, MotionResultView } from "../../assets/ts/member-flows/portal/sections/Votes/VoteResults";
import type { ElectionVoteResult, MotionVoteResult, VoteCandidate } from "../../assets/ts/member-flows/portal/types";

const ADA = "00000000-0000-4000-8000-000000000001";
const GRACE = "00000000-0000-4000-8000-000000000002";

/** Parsed through the shared schema, so a fixture cannot drift from the contract. */
function motion(overrides: Record<string, unknown> = {}): MotionVoteResult {
  return motionVoteResultSchema.parse({
    thresholdType: "simple_majority",
    counts: { in_favor: 7, opposed: 2, abstain: 1 },
    totalBallots: 10,
    quorum: null,
    castingVote: null,
    outcome: "passed",
    ...overrides,
  });
}

function election(overrides: Record<string, unknown> = {}): ElectionVoteResult {
  return electionVoteResultSchema.parse({
    rounds: [
      { round: 1, counts: { [ADA]: 4, [GRACE]: 3 }, eliminatedCandidateIds: [GRACE], winnerCandidateId: null },
      { round: 2, counts: { [ADA]: 7 }, eliminatedCandidateIds: [], winnerCandidateId: ADA },
    ],
    winnerCandidateId: ADA,
    ...overrides,
  });
}

function candidates(): VoteCandidate[] {
  return [
    { id: ADA, userId: null, candidateName: "Ada Lovelace", candidateBio: null, sortOrder: 1, eliminatedRound: null },
    { id: GRACE, userId: null, candidateName: "Grace Hopper", candidateBio: null, sortOrder: 2, eliminatedRound: 1 },
  ].map((candidate) => candidateSummarySchema.parse(candidate));
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("closed vote results", () => {
  it("states a motion's outcome in words beside its tone, not in the tone alone", () => {
    const view = mount(<MotionResultView result={motion()} />);

    const badge = view.querySelector(".pk-badge");
    expect(badge?.textContent).toBe("Passed");
    // The tone modifier is present, but it is not the only carrier: the label
    // says "Passed" for anyone who cannot separate the green from the red.
    expect(badge?.className).toContain("pk-badge--ok");
    expect(view.textContent).toContain("7 in favor · 2 opposed · 1 abstained (10 ballots cast)");
  });

  it("says a question was not settled rather than rejected when turnout fell short", () => {
    const view = mount(
      <MotionResultView
        result={motion({
          outcome: "not_quorate",
          counts: { in_favor: 1, opposed: 0, abstain: 0 },
          totalBallots: 1,
          quorum: { percent: 50, eligible: 10, required: 5, met: false },
        })}
      />,
    );

    expect(view.querySelector(".pk-badge")?.textContent).toBe("Not decided — turnout too low");
    expect(view.textContent).toContain("Turnout 1 of 10 eligible; 50% required 5 ballots.");
  });

  it("names the deciding vote's holder and direction when a tie was broken", () => {
    const view = mount(
      <MotionResultView result={motion({ castingVote: { role: "deputy_lead", choice: "opposed" } })} />,
    );

    expect(view.textContent).toContain("settled by the vice chair’s deciding vote against.");
  });

  it("gives every election round a heading, so the tallies are not a stack of unnamed lists", () => {
    const view = mount(<ElectionResultView result={election()} candidates={candidates()} />);

    expect([...view.querySelectorAll("h6")].map((heading) => heading.textContent)).toEqual(["Round 1", "Round 2"]);
    // Each heading introduces exactly one list of tallies.
    expect(view.querySelectorAll("ul")).toHaveLength(2);
    expect(view.querySelector("ul")?.textContent).toContain("Ada Lovelace: 4");
    expect(view.querySelector("ul")?.textContent).toContain("Grace Hopper: 3 (eliminated)");
  });

  it("marks the winner with a word as well as a tone", () => {
    const view = mount(<ElectionResultView result={election()} candidates={candidates()} />);

    const badge = view.querySelector(".pk-badge");
    expect(badge?.textContent).toBe("Elected");
    expect(badge?.className).toContain("pk-badge--ok");
    expect(view.querySelector(".pk-strong")?.textContent).toBe("Ada Lovelace");
  });

  it("renders a result whose candidates it cannot name rather than failing on it", () => {
    // A round can reference a candidate the summary list no longer carries —
    // withdrawn, or fetched separately and out of step. Falling back to the id
    // keeps the tally readable instead of blanking the round.
    const view = mount(<ElectionResultView result={election({ winnerCandidateId: null })} candidates={[]} />);

    expect(view.querySelector(".pk-badge")).toBeNull();
    expect(view.textContent).toContain(`${ADA}: 4`);
  });

  it("renders an election that never ran a round without throwing", () => {
    const view = mount(
      <ElectionResultView result={election({ rounds: [], winnerCandidateId: null })} candidates={candidates()} />,
    );

    expect(view.querySelectorAll("h6")).toHaveLength(0);
    expect(view.querySelectorAll("ul")).toHaveLength(0);
  });
});
