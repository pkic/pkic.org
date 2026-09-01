// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupEventCommunications } from "../../assets/ts/member-flows/portal/sections/management/GroupEventCommunications";

let container: HTMLDivElement | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<GroupEventCommunications groupId="group-1" eventId="event-1" />, container!);
    await Promise.resolve();
  });
  await settle();
  return container;
}

beforeEach(() => {
  history.replaceState({}, "", "/");
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
  history.replaceState({}, "", "/");
});

describe("GroupEventCommunications", () => {
  it("keeps the disclosure the platform already provides rather than rebuilding one", async () => {
    const root = await mount();

    const details = root.querySelector("details");
    expect(details).not.toBeNull();
    // A <details> is reachable by keyboard and announced as a disclosure with
    // no role, handler or state of its own.
    expect(details?.querySelector("summary")?.textContent).toBe("Email campaigns");
  });

  it("names its tab set, so it is not one more anonymous strip on the page", async () => {
    const root = await mount();

    const tablist = root.querySelector('[role="tablist"]');
    expect(tablist?.getAttribute("aria-label")).toBe("Campaign audience");
    const tabs = [...root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(["Attendees", "Speakers"]);
  });

  it("marks the current audience as selected rather than only tinting it", async () => {
    const root = await mount();

    const [attendees, speakers] = root.querySelectorAll('[role="tab"]');
    expect(attendees.getAttribute("aria-selected")).toBe("true");
    expect(speakers.getAttribute("aria-selected")).toBe("false");

    await act(async () => {
      (speakers as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await settle();

    const after = root.querySelectorAll('[role="tab"]');
    expect(after[1].getAttribute("aria-selected")).toBe("true");
    // The audience is URL-addressed, so the position survives a reload.
    expect(window.location.hash).toContain("commsTab=speakers");
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

  it("survives a campaigns request that fails instead of rendering a blank panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "server_error", message: "Nope" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    const root = await mount();

    // The disclosure and its named tab set are still there for the reader to
    // retry from; a failed load does not take the surface down with it.
    expect(root.querySelector("summary")?.textContent).toBe("Email campaigns");
    expect(root.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Campaign audience");
  });
});
