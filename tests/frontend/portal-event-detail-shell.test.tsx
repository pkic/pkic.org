// @vitest-environment jsdom
/**
 * The event workspace shell and the detail header inside it.
 *
 * Both were plain layout before — a `<div>` with a `d-flex` header and an
 * `<h5 class="mb-1">` that no outline could see. What is asserted here is the
 * structure a reader is given: a named tab set, a real heading, and what the
 * surface says when the record cannot be loaded at all.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetail } from "../../assets/shared/schemas/event-management";
import { EventDetailView } from "../../assets/ts/member-flows/portal/sections/events/detail/EventDetail";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", vi.fn()],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const mounted: HTMLElement[] = [];

const eventDetail: EventDetail = {
  id: "40000000-0000-4000-8000-000000000001",
  ownerGroupId: null,
  seriesId: null,
  basePath: null,
  slug: "pqc-conference-amsterdam-nl",
  name: "PQC Conference Amsterdam",
  timezone: "Europe/Amsterdam",
  startsAt: "2026-09-01T08:00:00.000Z",
  endsAt: "2026-09-02T17:00:00.000Z",
  profileKey: "conference",
  sourceMode: "portal",
  registrationPolicy: "required",
  visibility: "public",
  inviteLimitAttendee: 5,
  updatedAt: "2026-08-01T00:00:00.000Z",
  userRetentionDays: null,
  venue: "Amsterdam",
  virtualUrl: null,
  heroImageUrl: null,
  location: "Amsterdam",
  sessionTypes: null,
  links: [],
  settings: {},
  capabilities: ["read"],
};

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container));
  mounted.push(container);
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

describe("event detail shell", () => {
  it("heads the record with a real heading and names the tab set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ event: eventDetail }))),
    );

    const container = mount(<EventDetailView slug={eventDetail.slug} />);
    await settle();

    // The event's name used to be an `<h5>` chosen for its size. It heads the
    // record, so it is a heading the outline can see.
    const heading = container.querySelector("h1, h2, h3, h4");
    expect(heading?.textContent).toBe("PQC Conference Amsterdam");

    // The page carries more than one set of tabs once a tab's own
    // sub-navigation renders, so this one says which set it is.
    const tabs = container.querySelector("nav.pk-tabs");
    expect(tabs?.getAttribute("aria-label")).toBe("Event sections");
    // The current tab is announced through `aria-current`, not through a
    // colour on the link.
    expect(tabs?.querySelector('[aria-current="page"]')?.textContent).toBe("Proposals");

    // The reload control carries a name rather than only a glyph.
    const refresh = [...container.querySelectorAll("button")].find((button) => button.textContent === "Refresh");
    expect(refresh).toBeDefined();
  });

  it("announces a failed load as an alert instead of an empty workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("event unavailable", { status: 502 }))),
    );

    const container = mount(<EventDetailView slug={eventDetail.slug} />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    expect(container.querySelector("nav.pk-tabs")).toBeNull();
  });
});
