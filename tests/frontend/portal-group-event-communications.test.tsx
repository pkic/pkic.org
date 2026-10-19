// @vitest-environment jsdom
/** The event's Communications section opens a focused message composer. */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupEventCommunications } from "../../assets/ts/member-flows/portal/sections/management/GroupEventCommunications";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(composing = false): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(
      <GroupEventCommunications
        groupId="group-1"
        eventId="event-1"
        eventSlug="event-1"
        composing={composing}
        listPath="/x/communications"
      />,
      container!,
    );
    await Promise.resolve();
  });
  await settle();
  return container;
}

beforeEach(() => {
  navigate.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/days") ? [] : { campaigns: [], total: 0 };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }),
  );
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("GroupEventCommunications", () => {
  it("offers one message action without audience navigation on the landing page", async () => {
    const root = await mount();

    expect(
      root.querySelector('a[href="#/x/communications/new?campaignPreset=session-planning"]')?.textContent,
    ).toContain("Ask attendees to plan sessions");
    expect(root.querySelector("details")).toBeNull();
    expect(root.querySelector("summary")).toBeNull();
    expect(root.querySelector("select")).toBeNull();
    expect(root.querySelector('a[href="#/x/communications/new"]')?.textContent).toContain("New message");
  });

  it("puts audience and filters inside the message form", async () => {
    const root = await mount(true);

    const control = [...root.querySelectorAll<HTMLSelectElement>("select")].find(
      (item) => item.id && root.querySelector(`label[for="${item.id}"]`)?.textContent === "Audience",
    );
    expect(control).not.toBeNull();
    expect([...control!.options].map((option) => option.textContent)).toEqual([
      "Attendees",
      "Speakers",
      "Invited attendees",
      "Invited speakers",
    ]);
    expect(root.textContent).toContain("New event message");
  });

  it("carries no Bootstrap class names", async () => {
    const root = await mount();

    const bootstrap =
      /^(btn|card|row|col|d-flex|form-control|text-muted|fw-\w+|p[trblxy]?-\d|m[trblxy]?-\d|border(-\w+)?)$/;
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      for (const name of element.classList) {
        expect(bootstrap.test(name)).toBe(false);
      }
    }
  });
});
