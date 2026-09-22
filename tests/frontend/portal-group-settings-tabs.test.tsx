// @vitest-environment jsdom
/**
 * The group's settings, as one page with two tabs.
 *
 * The general settings and the membership-category eligibility rules used to
 * be two panels stacked down one view, each with its own heading and its own
 * Save, so a reader looking for eligibility scrolled past a form they were
 * not editing to reach it (#35). What is asserted here is what a screenshot
 * cannot show: that the two halves are a real tab set, that only the open one
 * is mounted — the eligibility editor fetches, and must not fetch while it is
 * behind a tab nobody opened — and that the open tab is in the URL, so a link
 * to the rules opens on the rules.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupSettingsDetailSchema } from "../../assets/shared/schemas/groups";
import { GroupSettingsTabs } from "../../assets/ts/member-flows/portal/sections/management/GroupSettingsTabs";
// Imported for its side effect on the module registry: the eligibility tab
// reaches it through `lazy()`, and an unwarmed dynamic import leaves the
// Suspense fallback on screen for the whole test.
import "../../assets/ts/member-flows/portal/sections/management/GroupCategoryRulesEditor";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";

const hashParams = { value: "" };
vi.mock("../../assets/ts/hooks/useHashQueryParam", () => ({
  useHashQueryParam: (_key: string, fallback: string) => [
    hashParams.value || fallback,
    (next: string) => {
      hashParams.value = next;
    },
  ],
}));

const group = groupSettingsDetailSchema.parse({
  abbreviatedName: null,
  id: GROUP_ID,
  slug: "architecture",
  name: "Architecture Committee",
  type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
  parentGroup: null,
  description: "Coordinates platform architecture.",
  links: [],
  visibility: "participants",
  governanceInheritanceMode: "inherited",
  eligibilityMode: "managed",
  automaticEnrollmentMode: "none",
  allowAutomaticOptOut: false,
  publicLeadership: false,
  publicRoster: false,
  minEndorsersForBallot: 2,
  active: true,
  revision: 4,
  membershipCapacityCount: 4,
  representedMemberCount: 3,
  participantCount: 3,
  childCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const mounted: HTMLElement[] = [];

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<GroupSettingsTabs group={group} onUpdated={vi.fn(async () => undefined)} />, container));
  return container;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function tabNamed(container: HTMLElement, name: string): HTMLElement {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!tab) throw new Error(`no "${name}" tab rendered`);
  return tab;
}

afterEach(() => {
  hashParams.value = "";
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group settings tabs", () => {
  it("offers General and Eligibility as one named tab set, opening on General", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input), location.origin).pathname);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    const container = mount();
    await settle();

    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())).toEqual([
      "General",
      "Eligibility",
    ]);
    // Named, so a reader listing the page's landmarks is not offered an
    // anonymous strip of "Sections".
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Group settings");
    expect(tabNamed(container, "General").getAttribute("aria-selected")).toBe("true");

    // The general form is here; the eligibility editor has not loaded, and in
    // particular has not fetched the rules of a tab nobody opened.
    expect(container.querySelector('button[aria-label="Group settings actions"]')).not.toBeNull();
    expect(container.querySelector("input,select,textarea")).toBeNull();
    expect(requests.some((path) => path.endsWith("/category-rules"))).toBe(false);
  });

  it("opens straight onto the rules when the URL says Eligibility", async () => {
    hashParams.value = "eligibility";
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input), location.origin).pathname;
        requests.push(path);
        if (path.endsWith("/category-rules")) {
          return Response.json({ groupId: GROUP_ID, revision: 0, rules: [] });
        }
        return Response.json({ categories: [], form: null });
      }),
    );

    const container = mount();
    await settle();

    expect(tabNamed(container, "Eligibility").getAttribute("aria-selected")).toBe("true");
    // The rules are what this tab is for, so opening it is what asks for them.
    expect(requests.some((path) => path.endsWith("/category-rules"))).toBe(true);
    // And the form the other tab holds is not also on screen.
    expect(container.textContent).not.toContain("Save group settings");
  });
});
