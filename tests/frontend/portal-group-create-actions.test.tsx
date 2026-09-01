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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
  it("keeps event, form, and vote creation behind each list's create action", async () => {
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

    const events = mount(<GroupEvents groupId={GROUP_ID} canManage />);
    const forms = mount(<GroupForms groupId={GROUP_ID} canManage />);
    const votes = mount(<GroupVotes groupId={GROUP_ID} canManage canParticipate />);
    await settle();

    expect(events.textContent).not.toContain("New group event");
    expect(forms.textContent).not.toContain("New group form");
    expect(createVoteForm(votes)).toBeNull();

    function clickButton(container: HTMLElement, label: string): Promise<void> {
      const candidate = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === label,
      );
      expect(candidate).not.toBeUndefined();
      return act(async () => {
        candidate?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    await clickButton(events, "Create event");
    await clickButton(forms, "New form");
    await clickButton(votes, "Create vote");

    expect(events.textContent).toContain("New group event");
    expect(forms.textContent).toContain("New group form");
    expect(createVoteForm(votes)).not.toBeNull();

    await clickButton(events, "Cancel");
    await clickButton(forms, "Cancel");
    await clickButton(votes, "Cancel");

    expect(events.textContent).not.toContain("New group event");
    expect(forms.textContent).not.toContain("New group form");
    expect(createVoteForm(votes)).toBeNull();
  });
});
