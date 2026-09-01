// @vitest-environment jsdom
/**
 * Casting a ballot.
 *
 * The candidate radios used to be loose `form-check-input`s inside
 * `list-group-item` labels: nothing grouped them, so they were announced one
 * at a time with no sense of being one choice, and the three-part check block
 * the design system needs was only a third present.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memberVoteSchema, submitBallotSchema } from "../../assets/shared/schemas/votes";
import type { MemberVote } from "../../assets/ts/member-flows/portal/types";
import { BallotForm } from "../../assets/ts/member-flows/portal/sections/Votes/BallotForm";

let container: HTMLDivElement | null = null;
let toastArea: HTMLDivElement | null = null;

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const VOTE_ID = "20000000-0000-4000-8000-000000000001";

function vote(overrides: Record<string, unknown>): MemberVote {
  return memberVoteSchema.parse({
    id: VOTE_ID,
    slug: "board-election-2026",
    title: "Board election 2026",
    description: null,
    voteType: "election",
    ownerGroupId: GROUP_ID,
    ownerGroupName: "Board",
    electorateMode: "per_member",
    thresholdType: "simple_majority",
    eligibleCategories: null,
    opensAt: "2026-01-01T00:00:00.000Z",
    closesAt: "2026-02-01T00:00:00.000Z",
    currentRound: 1,
    status: "open",
    visibility: "private",
    publicDetailLevel: "aggregate",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    candidates: null,
    canCastBallot: true,
    hasCastBallot: false,
    memberBallots: null,
    result: null,
    ...overrides,
  }) as MemberVote;
}

const CANDIDATES = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    userId: null,
    candidateName: "Ada Lovelace",
    candidateBio: "Standing for a second term.",
    sortOrder: 0,
    eliminatedRound: null,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    userId: null,
    candidateName: "Grace Hopper",
    candidateBio: null,
    sortOrder: 1,
    eliminatedRound: null,
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    userId: null,
    candidateName: "Eliminated Candidate",
    candidateBio: null,
    sortOrder: 2,
    eliminatedRound: 1,
  },
];

function mount(node: preact.VNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonLabelled(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  if (!found) throw new Error(`No button labelled ${label}`);
  return found;
}

beforeEach(() => {
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(toastArea);
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  toastArea?.remove();
  toastArea = null;
  vi.unstubAllGlobals();
});

describe("BallotForm — election", () => {
  it("groups the candidates as one named choice", () => {
    const root = mount(
      <BallotForm
        vote={vote({ candidates: CANDIDATES })}
        endpoint="/api/v1/votes/x/ballots"
        onCast={() => Promise.resolve()}
      />,
    );

    const fieldset = root.querySelector("fieldset");
    expect(fieldset?.querySelector("legend")?.textContent).toBe("Candidates");
    // An eliminated candidate is not on the ballot.
    expect([...root.querySelectorAll(".pk-check__label")].map((label) => label.firstChild?.textContent)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  it("carries all three parts of the check block, not only the outer one", () => {
    const root = mount(
      <BallotForm
        vote={vote({ candidates: CANDIDATES })}
        endpoint="/api/v1/votes/x/ballots"
        onCast={() => Promise.resolve()}
      />,
    );

    const labels = root.querySelectorAll("label.pk-check");
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      // A `pk-check` label with no `pk-check__input` inside renders the
      // operating system's own radio, which nothing else would catch.
      expect(label.querySelector("input.pk-check__input")).not.toBeNull();
      expect(label.querySelector("span.pk-check__label")).not.toBeNull();
    }
    expect(labels[0].querySelector(".pk-check__hint")?.textContent).toBe("Standing for a second term.");
  });

  it("keeps the cast button out of play until a candidate is chosen", async () => {
    const root = mount(
      <BallotForm
        vote={vote({ candidates: CANDIDATES })}
        endpoint="/api/v1/votes/x/ballots"
        onCast={() => Promise.resolve()}
      />,
    );

    expect(buttonLabelled(root, "Cast ballot").disabled).toBe(true);

    const first = root.querySelector<HTMLInputElement>("input.pk-check__input");
    await act(async () => {
      first?.click();
      await Promise.resolve();
    });

    expect(buttonLabelled(root, "Cast ballot").disabled).toBe(false);
  });

  it("sends a body the shared ballot contract accepts", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );
    const onCast = vi.fn(() => Promise.resolve());
    const root = mount(
      <BallotForm vote={vote({ candidates: CANDIDATES })} endpoint="/api/v1/votes/x/ballots" onCast={onCast} />,
    );

    await act(async () => {
      root.querySelector<HTMLInputElement>("input.pk-check__input")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      buttonLabelled(root, "Cast ballot").click();
      await Promise.resolve();
    });
    await settle();

    expect(bodies).toHaveLength(1);
    const parsed = submitBallotSchema.parse(bodies[0]);
    expect(parsed.choice).toBe(CANDIDATES[0].id);
    expect(onCast).toHaveBeenCalled();
  });

  it("reports a rejected ballot and does not tell the caller it was cast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "vote_closed", message: "This vote has closed." } }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const onCast = vi.fn(() => Promise.resolve());
    const root = mount(
      <BallotForm vote={vote({ candidates: CANDIDATES })} endpoint="/api/v1/votes/x/ballots" onCast={onCast} />,
    );

    await act(async () => {
      root.querySelector<HTMLInputElement>("input.pk-check__input")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      buttonLabelled(root, "Cast ballot").click();
      await Promise.resolve();
    });
    await settle();

    const toast = document.querySelector(".my-toast");
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.textContent).toBe("This vote has closed.");
    expect(toast?.classList.contains("pk-toast--danger")).toBe(true);
    expect(onCast).not.toHaveBeenCalled();
  });
});

describe("BallotForm — motion", () => {
  it("names the group of choices and offers all three", () => {
    const root = mount(
      <BallotForm
        vote={vote({ voteType: "motion" })}
        endpoint="/api/v1/votes/x/ballots"
        onCast={() => Promise.resolve()}
      />,
    );

    const group = root.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Cast your ballot");
    expect([...root.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "In favor",
      "Opposed",
      "Abstain",
    ]);
  });

  it("marks only the choice actually in flight as busy", async () => {
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
                new Response(JSON.stringify({ success: true }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
              );
          }),
      ),
    );
    const root = mount(
      <BallotForm
        vote={vote({ voteType: "motion" })}
        hasCastBallot
        endpoint="/api/v1/votes/x/ballots"
        onCast={() => Promise.resolve()}
      />,
    );

    expect(root.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Update your ballot");

    await act(async () => {
      buttonLabelled(root, "Opposed").click();
      await Promise.resolve();
    });

    const busy = [...root.querySelectorAll("button")].filter((button) => button.getAttribute("aria-busy") === "true");
    expect(busy.map((button) => button.textContent)).toEqual(["Opposed"]);
    held.release?.();
    await settle();
  });
});
