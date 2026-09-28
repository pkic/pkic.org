// @vitest-environment jsdom
/**
 * The event's Communications section keeps the audience in the URL while
 * selecting it with a labeled control.
 */
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
  it("shows the composer directly rather than behind a disclosure", async () => {
    const root = await mount();

    expect(root.querySelector("details")).toBeNull();
    expect(root.querySelector("summary")).toBeNull();
    expect(root.textContent).toContain("Email");
  });

  it("offers every campaign audience in one labeled selector", async () => {
    const root = await mount();

    const control = root.querySelector<HTMLSelectElement>("select");
    expect(control).not.toBeNull();
    expect(root.querySelector(`label[for="${control?.id}"]`)?.textContent).toBe("Audience");
    expect([...control!.options].map((option) => option.textContent)).toEqual([
      "Attendees",
      "Speakers",
      "Invited attendees",
      "Invited speakers",
    ]);
  });

  it("selects the current audience and navigates to the chosen address", async () => {
    const root = await mount("speakers");

    const control = root.querySelector<HTMLSelectElement>("select")!;
    expect(control.value).toBe("speakers");
    await act(() => {
      control.value = "attendee_invitations";
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith("/x/communications/attendee_invitations");
  });

  it("falls back to attendees for an audience the contract does not know", async () => {
    const root = await mount("sponsors");

    expect(root.querySelector<HTMLSelectElement>("select")?.value).toBe("attendees");
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

    expect(root.querySelector<HTMLSelectElement>("select")?.value).toBe("attendees");
  });
});
