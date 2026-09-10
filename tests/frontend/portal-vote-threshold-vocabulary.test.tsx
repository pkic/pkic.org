// @vitest-environment jsdom
/**
 * Issue #24's shape, reproduced deliberately: a vocabulary grows in the shared
 * contract and the form has to grow with it without anyone editing the form.
 * The threshold select is the hard case, because what it offers is a subset
 * chosen per vote type — a subset that is derived, not retyped, so a fourth
 * threshold reaches both vote types on its own.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GroupVoteCreateForm } from "../../assets/ts/member-flows/portal/sections/management/GroupVoteCreateForm";
import { controlFor as labeledControl, optionValues } from "./helpers/labelled-control";

// `vi.mock` is hoisted above every top-level binding, so the added value is
// written out inside the factory and named again below for the assertions.
vi.mock("../../assets/shared/schemas/votes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../assets/shared/schemas/votes")>();
  const THRESHOLD_TYPES = [...actual.THRESHOLD_TYPES, "unanimous"] as const;
  return { ...actual, THRESHOLD_TYPES, thresholdTypeSchema: z.enum(THRESHOLD_TYPES) };
});

const ADDED_THRESHOLD = "unanimous";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";

/** What the select a label names actually offers. */
function offeredBy(container: HTMLElement, label: string): string[] {
  return optionValues(labeledControl<HTMLSelectElement>(container, label));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("vote threshold options", () => {
  it("carries a threshold added to the shared vocabulary into the form", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupVoteCreateForm groupId={GROUP_ID} onCreated={async () => {}} />, container));

    // A motion excludes only successive elimination, so the new threshold is
    // offered here without the component naming it.
    expect(offeredBy(container, "Threshold")).toEqual(["simple_majority", "supermajority", ADDED_THRESHOLD]);

    const type = labeledControl<HTMLSelectElement>(container, "Type");
    await act(() => {
      type.value = "election";
      type.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // An election excludes only supermajority, so it reaches that select too.
    expect(offeredBy(container, "Threshold")).toEqual(["simple_majority", "successive_elimination", ADDED_THRESHOLD]);
  });
});
