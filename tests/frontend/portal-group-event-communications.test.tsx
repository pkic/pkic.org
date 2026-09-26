// @vitest-environment jsdom
/**
 * The event's Communications tab: the campaign composer for one audience,
 * with the audience a URL segment rather than a query parameter, and no
 * disclosure folded over the tab's whole purpose.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupEventCommunications } from "../../assets/ts/member-flows/portal/sections/management/GroupEventCommunications";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
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

async function mount(audience?: string): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(
      <GroupEventCommunications
        groupId="group-1"
        eventId="event-1"
        audience={audience}
        audienceHref={(key) => (key === "attendees" ? "/x/communications" : `/x/communications/${key}`)}
      />,
      container!,
    );
    await Promise.resolve();
  });
  await settle();
  return container;
}

beforeEach(() => {
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
  it("shows the composer directly rather than behind a disclosure", async () => {
    const root = await mount();

    expect(root.querySelector("details")).toBeNull();
    expect(root.querySelector("summary")).toBeNull();
    expect(root.textContent).toContain("Email");
  });

  it("names its tab set, so it is not one more anonymous strip on the page", async () => {
    const root = await mount();

    const nav = root.querySelector('nav[aria-label="Campaign audience"]');
    expect(nav).not.toBeNull();
    const tabs = [...root.querySelectorAll("a.pk-tabs__link")].map((tab) => tab.textContent);
    expect(tabs).toEqual(["Attendees", "Speakers", "Invited attendees", "Invited speakers"]);
  });

  it("marks the current audience and gives each audience its own address", async () => {
    const root = await mount("speakers");

    const [attendees, speakers] = root.querySelectorAll("a.pk-tabs__link");
    expect(attendees.getAttribute("aria-current")).toBeNull();
    expect(speakers.getAttribute("aria-current")).toBe("page");
    // The audience is URL-addressed, so a link to the speaker campaign opens on it.
    expect(attendees.getAttribute("href")).toBe("#/x/communications");
    expect(speakers.getAttribute("href")).toBe("#/x/communications/speakers");
  });

  it("falls back to attendees for an audience the contract does not know", async () => {
    const root = await mount("sponsors");

    const [attendees] = root.querySelectorAll("a.pk-tabs__link");
    expect(attendees.getAttribute("aria-current")).toBe("page");
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

    // The named tab set is still there for the reader to retry from; a failed
    // load does not take the surface down with it.
    expect(root.querySelector('nav[aria-label="Campaign audience"]')).not.toBeNull();
  });
});
