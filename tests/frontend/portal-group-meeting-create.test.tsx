// @vitest-environment jsdom
/**
 * Scheduling a recurring meeting from a group's Meetings view.
 *
 * What a screenshot cannot check: that the create page is a region a reader
 * can find by name, that its heading sits one rung below the workspace's,
 * and that a rejected create is announced as a sentence without throwing away
 * what was typed.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupMeetings } from "../../assets/ts/member-flows/portal/sections/management/GroupMeetings";
import { buttonNamed, controlFor, typeInto } from "./helpers/labelled-control";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("scheduling a group meeting series", () => {
  it("names the create form as its own region and states a rejected create in an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "POST") {
          return new Response(JSON.stringify({ message: "A series with that name already exists." }), {
            status: 409,
            headers: { "content-type": "application/json" },
          });
        }
        return json({ series: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }),
    );

    // Creation is its own page under the meetings view, reached by the
    // `new` segment rather than unfolded over the list.
    const container = mount(<GroupMeetings groupId={GROUP_ID} canManage seriesSegment="new" />);
    await settle();

    // The form is a named region, so it is reachable and identifiable, and
    // its heading is the next rung below the workspace's own.
    const form = container.querySelector('[aria-label="Schedule a recurring meeting"]');
    expect(form).not.toBeNull();
    expect(form?.querySelector("h3")?.textContent).toBe("Schedule a recurring meeting");

    await typeInto(controlFor(container, "Meeting name"), "Architecture call");
    await act(async () => {
      buttonNamed(container, "Create meeting series").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    // The reader gets a sentence, never the transport's own phrasing.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Someone else changed this at the same time.");
    expect(alert?.textContent).not.toContain("HTTP 409");
    // The form stays open on failure, so the typed name is not thrown away.
    expect(controlFor<HTMLInputElement>(container, "Meeting name").value).toBe("Architecture call");
  });
});
