// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupEvents } from "../../assets/ts/member-flows/portal/sections/management/GroupEvents";
import { GroupForms } from "../../assets/ts/member-flows/portal/sections/management/GroupForms";
import { GroupVotes } from "../../assets/ts/member-flows/portal/sections/management/GroupVotes";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

/**
 * The create-vote form, located by the name it exposes rather than by an id
 * on one of its inputs: the design system's Field generates its own id/for
 * pair, so a hard-coded `#group-vote-title` stops matching anything.
 */
function createVoteForm(container: HTMLElement): HTMLFormElement | null {
  return container.querySelector("form[aria-label='Create vote']");
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === label);
}

function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = findButton(container, label);
  expect(button).not.toBeUndefined();
  return act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function stubEmptyCollections(): void {
  const page = { limit: 50, offset: 0, total: 0, hasMore: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      if (url.pathname.endsWith("/events")) return json({ events: [], page });
      if (url.pathname.endsWith("/forms")) return json({ forms: [], page });
      if (url.pathname.endsWith("/votes")) return json({ votes: [], page });
      throw new Error(`Unexpected request: ${url.pathname}`);
    }),
  );
}

beforeEach(() => {
  navigate.mockReset();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group collection create actions", () => {
  it("keeps event creation behind the list's create action", async () => {
    stubEmptyCollections();

    const events = mount(<GroupEvents groupId={GROUP_ID} canManage />);
    await settle();

    expect(events.textContent).not.toContain("New group event");
    await clickButton(events, "Create event");
    expect(events.textContent).toContain("New group event");
    await clickButton(events, "Cancel");
    expect(events.textContent).not.toContain("New group event");
  });

  it("sends form and vote creation to their own addresses instead of unfolding inside the list", async () => {
    stubEmptyCollections();

    const forms = mount(<GroupForms groupId={GROUP_ID} canManage />);
    const votes = mount(<GroupVotes groupId={GROUP_ID} canManage canParticipate />);
    await settle();

    // Nothing is layered over either list to begin with.
    expect(forms.textContent).not.toContain("New group form");
    expect(createVoteForm(votes)).toBeNull();

    await clickButton(forms, "New form");
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/forms/new`);
    // The action navigates and does nothing else: the editor does not also
    // open in place, so this mount still shows only the list.
    expect(forms.textContent).not.toContain("New group form");

    navigate.mockReset();
    await clickButton(votes, "Create vote");
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/votes/new`);
    expect(createVoteForm(votes)).toBeNull();
  });

  it("renders each create segment as a page of its own, with a way back to its list", async () => {
    stubEmptyCollections();

    const forms = mount(<GroupForms groupId={GROUP_ID} canManage placementSegment="new" />);
    const votes = mount(<GroupVotes groupId={GROUP_ID} canManage canParticipate voteSegment="new" />);
    await settle();

    // The create page is the only thing on screen: the table and the toolbar
    // action that opened it are gone rather than sitting below the form.
    expect(forms.textContent).toContain("New group form");
    expect(forms.querySelector("table")).toBeNull();
    expect(findButton(forms, "New form")).toBeUndefined();
    expect(createVoteForm(votes)).not.toBeNull();
    expect(votes.querySelector("table")).toBeNull();

    await clickButton(forms, "← All forms");
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/forms`);

    navigate.mockReset();
    await clickButton(votes, "← All votes");
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/votes`);
  });

  it("returns a viewer who cannot manage from either create segment to the list", async () => {
    stubEmptyCollections();

    mount(<GroupForms groupId={GROUP_ID} canManage={false} placementSegment="new" />);
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/forms`);

    navigate.mockReset();
    mount(<GroupVotes groupId={GROUP_ID} canManage={false} canParticipate voteSegment="new" />);
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/votes`);
  });
});
