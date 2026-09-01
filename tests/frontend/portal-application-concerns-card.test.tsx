// @vitest-environment jsdom
/**
 * The consultation concerns raised against a membership application.
 *
 * The Bootstrap version drew a card whose header was a `<div>`, and said "None
 * submitted." as a muted `<li>` — a list item that is not an item, inside a
 * list that then claimed to have one entry. What is asserted here is what a
 * visual review cannot see: that the card names itself as a region, that an
 * empty card is announced rather than silently faint, and that a concern with
 * an unparsable timestamp is still rendered.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { MembershipApplicationDetail } from "../../assets/shared/schemas/membership-application-management";
import { ApplicationConcernsCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationConcernsCard";

const NOW = "2026-08-31T09:00:00.000Z";

function detail(concerns: MembershipApplicationDetail["concerns"]): MembershipApplicationDetail {
  return {
    id: "00000000-0000-4000-8000-000000000301",
    applicantEmail: "applicant@example.test",
    applicantName: "Example Applicant",
    organizationName: "Example Organization",
    membershipCategory: "F",
    membershipCategoryLabel: "General Member",
    stage: "in_consultation",
    onHoldSubtype: null,
    assignedToUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    stageEnteredAt: NOW,
    answers: {},
    requestedWorkingGroups: [],
    events: [],
    communications: [],
    concerns,
    ecDecisions: [],
  } as MembershipApplicationDetail;
}

function concern(overrides: Record<string, unknown> = {}): MembershipApplicationDetail["concerns"][number] {
  return {
    id: "00000000-0000-4000-8000-000000000401",
    concernText: "The organization's CA is not yet publicly disclosed.",
    createdAt: NOW,
    ...overrides,
  } as MembershipApplicationDetail["concerns"][number];
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

describe("membership application concerns card", () => {
  it("names itself as a region, so it is not one of several unnamed cards on the page", () => {
    const card = mount(<ApplicationConcernsCard detail={detail([concern()])} />);

    const region = card.querySelector("section.pk-panel");
    expect(region?.getAttribute("aria-label")).toBe("Consultation concerns");
    // The visible heading and the region's name say the same thing, so a
    // speech-input user can ask for what they can read.
    expect(region?.querySelector(".pk-panel__title")?.textContent).toBe("Consultation concerns");
  });

  it("lists each concern as a real list item with its own timestamp", () => {
    const card = mount(
      <ApplicationConcernsCard
        detail={detail([
          concern(),
          concern({ id: "00000000-0000-4000-8000-000000000402", concernText: "Second concern." }),
        ])}
      />,
    );

    const items = [...card.querySelectorAll("li")];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("The organization's CA is not yet publicly disclosed.");
    expect(items[0].querySelector(".pk-mono")?.textContent).toBeTruthy();
  });

  it("announces an empty card instead of hiding the fact in a muted list item", () => {
    const card = mount(<ApplicationConcernsCard detail={detail([])} />);

    // No list at all — an empty list with one apologetic row is a lie about
    // how many concerns there are.
    expect(card.querySelector("ul")).toBeNull();
    const empty = card.querySelector("[role='status']");
    expect(empty?.textContent).toContain("No concerns submitted.");
  });

  it("renders a concern whose timestamp cannot be formatted rather than failing on it", () => {
    const card = mount(<ApplicationConcernsCard detail={detail([concern({ createdAt: "not-a-date" })])} />);

    expect(card.querySelectorAll("li")).toHaveLength(1);
    expect(card.textContent).toContain("The organization's CA is not yet publicly disclosed.");
  });
});
