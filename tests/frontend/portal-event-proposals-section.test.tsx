// @vitest-environment jsdom
/**
 * The event's proposals section: its tab strip and the two presentation
 * archive links above the catalogue. The links are navigations, so they stay
 * anchors and only borrow the button's appearance.
 */
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPageInfo } from "../../assets/shared/schemas/pagination";
import { eventProposalsResponseSchema } from "../../assets/shared/schemas/event-proposals";
import { Proposals } from "../../assets/ts/member-flows/portal/sections/events/detail/Proposals";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement | null = null;

const ACCESS = {
  eventPermissions: ["proposals:read"],
  canRead: true,
  canReview: false,
  canFinalize: false,
  canEditAcceptedAbstract: false,
  canCancelAcceptedProposal: false,
};

function proposalsBody(access: typeof ACCESS) {
  return eventProposalsResponseSchema.parse({
    proposals: [],
    page: buildPageInfo(25, 0, 0, 0),
    event: { id: "11111111111111111111111111111111", slug: "spring-summit", name: "Spring Summit" },
    access,
    stats: { byStatus: {}, byRecommendation: {}, reviewedCount: 0, unreviewedCount: 0, total: 0 },
  });
}

function respond(access: typeof ACCESS): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(proposalsBody(access)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(canWrite = true): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<Proposals slug="spring-summit" canWrite={canWrite} />, container!);
    await Promise.resolve();
  });
  await settle();
  await settle();
  return container;
}

beforeEach(() => {
  respond(ACCESS);
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("event Proposals section", () => {
  it("names its tab strip instead of leaving it as one more anonymous nav", async () => {
    const root = await mount();

    const nav = root.querySelector("nav.pk-tabs");
    expect(nav?.getAttribute("aria-label")).toBe("Proposal sections");
    expect([...root.querySelectorAll("nav.pk-tabs a")].map((link) => link.textContent)).toEqual([
      "Overview",
      "Responses",
      "Email",
    ]);
  });

  it("marks the current section with aria-current rather than a tint", async () => {
    const root = await mount();

    const current = root.querySelector('nav.pk-tabs a[aria-current="page"]');
    expect(current?.textContent).toBe("Overview");
  });

  it("keeps the archive downloads as named links, not buttons", async () => {
    const root = await mount();

    const group = root.querySelector('[role="group"][aria-label="Download event presentations"]');
    expect(group).not.toBeNull();

    const links = [...(group?.querySelectorAll("a") ?? [])];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.tagName).toBe("A");
      expect(link.className).toBe("pk-btn pk-btn--secondary pk-btn--sm");
    }
    // The arrow is decoration; the accessible name is the words beside it.
    expect(links[0].querySelector('[aria-hidden="true"]')?.textContent).toBe("↓");
    expect(links[0].textContent?.replace("↓", "").trim()).toBe("Current presentations");
    // "All versions" said nothing on its own once read out of the group.
    expect(links[1].textContent).toBe("All presentation versions");
    expect(links[1].getAttribute("href")).toContain("versions=all");
  });

  it("hides the archive links from a reader who may not read proposals", async () => {
    respond({ ...ACCESS, canRead: false });
    const root = await mount();

    expect(root.querySelector('[role="group"][aria-label="Download event presentations"]')).toBeNull();
  });

  it("drops the email tab for a reader who cannot write", async () => {
    const root = await mount(false);

    expect([...root.querySelectorAll("nav.pk-tabs a")].map((link) => link.textContent)).toEqual([
      "Overview",
      "Responses",
    ]);
  });
});
