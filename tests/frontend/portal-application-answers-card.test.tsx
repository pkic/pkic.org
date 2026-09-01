// @vitest-environment jsdom
/**
 * The answers a membership applicant gave, as staff read them back.
 *
 * These are label-and-value once each, so the surface is a description list
 * rather than the unnamed two-column table it used to be. What is asserted
 * here is what a visual review cannot see: that the block names itself, that
 * every answer is tied to its own term, that a blank answer says so in words
 * rather than only by looking faint, and that a malformed answer is rendered
 * rather than crashing the card.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { MembershipApplicationDetail } from "../../assets/shared/schemas/membership-application-management";
import { ApplicationAnswersCard } from "../../assets/ts/member-flows/portal/sections/membership-applications/ApplicationAnswersCard";

const NOW = "2026-08-31T09:00:00.000Z";

function detail(overrides: Partial<MembershipApplicationDetail> = {}): MembershipApplicationDetail {
  return {
    id: "00000000-0000-4000-8000-000000000301",
    applicantEmail: "applicant@example.test",
    applicantName: "Example Applicant",
    organizationName: "Example Organization",
    membershipCategory: "F",
    membershipCategoryLabel: "General Member",
    stage: "ec_review",
    onHoldSubtype: null,
    assignedToUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    stageEnteredAt: NOW,
    answers: {},
    requestedWorkingGroups: [],
    events: [],
    communications: [],
    concerns: [],
    ecDecisions: [],
    ...overrides,
  } as MembershipApplicationDetail;
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

/** The `dd` that answers the term reading `term`. */
function answerTo(root: ParentNode, term: string): HTMLElement {
  const dt = [...root.querySelectorAll("dt")].find((candidate) => candidate.textContent === term);
  if (!dt) throw new Error(`no term reads "${term}"`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`term "${term}" is followed by no value`);
  return dd as HTMLElement;
}

/** Every term in document order — the answers the card promises to show. */
function termNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("dt")].map((dt) => dt.textContent ?? "");
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("membership application answers card", () => {
  it("names itself as a region and pairs every answer with its own term", () => {
    const page = mount(<ApplicationAnswersCard detail={detail()} />);

    // A card among a column of cards has to say which one it is; four unnamed
    // sections are announced as four sections.
    const region = page.querySelector("section");
    expect(region?.getAttribute("aria-label")).toBe("Application answers");
    expect(page.querySelector("h3")?.textContent).toBe("Application answers");

    expect(termNames(page)).toEqual([
      "Role / Job title",
      "LinkedIn",
      "Organization website",
      "About yourself",
      "About organization",
      "Reason for joining",
      "Contribution type",
      "Wants to present",
      "Interested in sponsoring",
      "Working groups requested",
      "Legal agreements",
      "Warranted authority",
    ]);

    // Every term is answered, and the pairs are direct children of the list —
    // a wrapper between them would take both out of the two-column grid.
    const list = page.querySelector("dl")!;
    expect(list.querySelectorAll(":scope > dt")).toHaveLength(12);
    expect(list.querySelectorAll(":scope > dd")).toHaveLength(12);

    // It is a list, not a grid: as an unnamed table it was announced as one.
    expect(page.querySelector("table")).toBeNull();
  });

  it("says a blank answer in words, not only by looking faint", () => {
    const page = mount(<ApplicationAnswersCard detail={detail()} />);

    const jobTitle = answerTo(page, "Role / Job title");
    expect(jobTitle.textContent).toContain("Not provided");
    // The dash is decoration beside the word, and is kept out of the
    // accessibility tree rather than read as punctuation.
    expect(jobTitle.querySelector('[aria-hidden="true"]')?.textContent).toBe("—");

    // A boolean answer is already a word, so it is never dashed.
    expect(answerTo(page, "Wants to present").textContent).toBe("No");
    expect(answerTo(page, "Warranted authority").textContent).toBe("No");
  });

  it("shows the answers that were given, linking the ones that are addresses", () => {
    const page = mount(
      <ApplicationAnswersCard
        detail={detail({
          answers: {
            job_title: "Principal Engineer",
            linkedin: "linkedin.com/in/example",
            organization_website: "https://example.test",
            wantsToPresent: true,
            interestedInSponsoring: true,
            warrantedAuthority: true,
            legalAgreements: ["Code of Conduct", "IPR Policy"],
          },
          requestedWorkingGroups: [
            { slug: "wg-one", name: "Working Group One" },
            { slug: "wg-two", name: "Working Group Two" },
          ],
        })}
      />,
    );

    expect(answerTo(page, "Role / Job title").textContent).toBe("Principal Engineer");
    expect(answerTo(page, "Wants to present").textContent).toBe("Yes");
    expect(answerTo(page, "Legal agreements").textContent).toBe("Code of Conduct, IPR Policy");

    // A bare host gains the scheme it needs to be a link at all, and the
    // reader still sees what they typed.
    const linkedin = answerTo(page, "LinkedIn").querySelector("a")!;
    expect(linkedin.getAttribute("href")).toBe("https://linkedin.com/in/example");
    expect(linkedin.textContent).toBe("linkedin.com/in/example");
    // An outbound link opened in a new context does not hand the opener over.
    expect(linkedin.getAttribute("rel")).toBe("noreferrer");

    const groups = answerTo(page, "Working groups requested").querySelectorAll("li");
    expect([...groups].map((item) => item.textContent)).toEqual(["Working Group One", "Working Group Two"]);
  });

  it("renders an answer that arrived in the wrong shape rather than failing with the card", () => {
    // `answers` is an open record of unknowns, so nothing upstream guarantees
    // a string. A number, a null and a non-array where a list was expected
    // must all still read as something.
    const page = mount(
      <ApplicationAnswersCard
        detail={detail({
          answers: {
            job_title: 42,
            reason: null,
            contributionType: { unexpected: true },
            legalAgreements: "not an array",
            wantsToPresent: "yes",
          },
        })}
      />,
    );

    expect(answerTo(page, "Role / Job title").textContent).toBe("42");
    expect(answerTo(page, "Reason for joining").textContent).toContain("Not provided");
    expect(answerTo(page, "Contribution type").textContent).toBe("[object Object]");
    // A non-array is not a list of agreements, so it is reported as absent
    // rather than spread into characters.
    expect(answerTo(page, "Legal agreements").textContent).toContain("Not provided");
    // Only a real `true` is a yes; a truthy string is not.
    expect(answerTo(page, "Wants to present").textContent).toBe("No");
  });
});
