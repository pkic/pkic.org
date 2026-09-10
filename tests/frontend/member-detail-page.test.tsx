// @vitest-environment jsdom
/**
 * The public member profile page: what it fetches, what it renders for each
 * result shape, and — the part a visual review cannot check — what the page
 * exposes to someone who is not looking at it.
 *
 * The payloads here are parsed by `publicMemberDetailSchema` on the way out,
 * because that is what `getJson` parses on the way in: a fixture that drifts
 * from the shared contract fails here rather than passing against a shape the
 * endpoint never sends.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberDetailPage, MemberDetailView } from "../../assets/ts/member-flows/member-detail-page";
import { publicMemberDetailSchema } from "../../assets/shared/schemas/members-directory";

const mounted: HTMLElement[] = [];

type MemberPayload = Record<string, unknown>;

function publicMember(overrides: MemberPayload = {}): MemberPayload {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "example-corp",
    name: "Example Corp",
    memberType: "organization",
    tier: null,
    memberSince: "2024-03-01T00:00:00.000Z",
    website: "https://example.test/",
    description: "A certificate authority.",
    slogan: "Trust, verified.",
    logoUrl: null,
    content: null,
    blogUrl: null,
    blogFeedUrl: null,
    pressUrl: null,
    pressFeedUrl: null,
    careersUrl: null,
    links: [],
    identities: [],
    jobTitle: null,
    featuredLink: null,
    ...overrides,
  };
}

/** The fixture as the endpoint would send it, contract-checked on the way out. */
function memberResponse(overrides: MemberPayload = {}): string {
  return JSON.stringify(publicMemberDetailSchema.parse(publicMember(overrides)));
}

/** The parsed record, for the tests that render the view without a fetch. */
function memberRecord(overrides: MemberPayload = {}) {
  return publicMemberDetailSchema.parse(publicMember(overrides));
}

function stubFetch(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function attach(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  return container;
}

async function mountPage(directoryHref = "/members/"): Promise<HTMLElement> {
  const container = attach();
  await act(() => {
    render(<MemberDetailPage apiBase="/api/v1" directoryHref={directoryHref} />, container);
  });
  // The fetch is started in an effect, so let its microtasks drain.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

async function mountView(overrides: MemberPayload = {}): Promise<HTMLElement> {
  const container = attach();
  await act(() => {
    render(<MemberDetailView member={memberRecord(overrides)} directoryHref="/members/" />, container);
  });
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  window.history.replaceState({}, "", "/members/profile/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public member detail page", () => {
  it("fetches the member named by ?id= and heads the page with a single name", async () => {
    window.history.replaceState({}, "", "/members/profile/?id=example-corp");
    const fetchMock = stubFetch(memberResponse());

    const container = await mountPage();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/v1/members/example-corp");

    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toContain("Example Corp");
    // The surface opts into the design system's base layer as a whole.
    expect(container.querySelector(".pk")).not.toBeNull();
  });

  it("takes the member from the last path segment when there is no query string", async () => {
    window.history.replaceState({}, "", "/members/example-corp/");
    const fetchMock = stubFetch(memberResponse());

    await mountPage();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/v1/members/example-corp");
  });

  it("announces the wait, by name, before the member arrives", async () => {
    window.history.replaceState({}, "", "/members/profile/?id=example-corp");
    // Never resolves, so the loading state is what stays on screen.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const container = attach();
    await act(() => {
      render(<MemberDetailPage apiBase="/api/v1" directoryHref="/members/" />, container);
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("Loading member profile…");
  });

  it("states a failed load rather than leaving a blank profile behind", async () => {
    window.history.replaceState({}, "", "/members/profile/?id=example-corp");
    stubFetch(JSON.stringify({ error: "boom" }), 503);

    const container = await mountPage();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("The service is temporarily unavailable.");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("offers the way back when the member does not exist", async () => {
    window.history.replaceState({}, "", "/members/profile/?id=missing");
    stubFetch(JSON.stringify({ error: "not found" }), 404);

    const container = await mountPage("/members/");

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("We couldn’t find that member.");
    const back = container.querySelector<HTMLAnchorElement>('a[href="/members/"]');
    expect(back?.textContent).toContain("Back to members");
  });

  it("falls through to not found when the shell is opened with no member at all", async () => {
    window.history.replaceState({}, "", "/members/profile/");
    const fetchMock = stubFetch(memberResponse());

    const container = await mountPage();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("We couldn’t find that member.");
  });
});

describe("public member detail content", () => {
  it("keeps a cached single-link representative readable during deployment", async () => {
    const container = await mountView({
      identities: [
        {
          name: "Cached Representative",
          jobTitle: null,
          bio: null,
          featuredLink: "https://www.linkedin.com/in/cached-person",
          photoUrl: null,
        },
      ],
    });
    expect(container.querySelector('a[href="https://www.linkedin.com/in/cached-person"]')?.textContent).toContain(
      "LinkedIn",
    );
  });

  function terms(list: Element): string[] {
    return [...list.querySelectorAll(":scope > dt")].map((term) => term.textContent ?? "");
  }

  it("pairs each piece of metadata with its term instead of running labels and values together", async () => {
    const container = await mountView({
      website: "https://example.test/",
      pressUrl: "https://example.test/press",
      careersUrl: "https://example.test/jobs",
      blogUrl: "https://example.test/blog",
      links: ["https://mastodon.example/@example"],
    });

    const list = container.querySelector("dl.pk-datalist");
    expect(list).not.toBeNull();
    // The named pages the organization publishes stay a term list. Its own
    // profile links do not: they are an owner-ordered, open-ended set with no
    // term to pair against, so they render as the shared marked badges.
    expect(terms(list!)).toEqual(["Member since", "Website", "Press", "Careers", "Blog"]);
    expect(list!.querySelectorAll(":scope > dd")).toHaveLength(5);
    expect([...container.querySelectorAll(".pk-link-list__label")].map((label) => label.textContent)).toEqual([
      "mastodon.example",
    ]);
    // Localized at the presentation boundary rather than printed as the
    // transported instant. The month's spelling belongs to the viewer's
    // locale, so only the year is asserted.
    const since = [...list!.querySelectorAll(":scope > dd")][0]?.textContent ?? "";
    expect(since).toContain("2024");
    expect(since).not.toContain("2024-03-01");
  });

  it("shows every profile link as a marked badge, labeled by site and named after its owner", async () => {
    // No platform is special: the owner's own ordering is the order shown.
    const container = await mountView({
      links: ["https://github.com/example-corp", "https://www.linkedin.com/company/example"],
      featuredLink: "https://github.com/example-corp",
      identities: [
        {
          name: "Ada Lovelace",
          jobTitle: "Chief Engineer",
          bio: null,
          links: ["https://www.linkedin.com/in/ada", "https://x.com/ada"],
          photoUrl: null,
        },
      ],
    });

    const badges = [...container.querySelectorAll("a.pk-link-list__link")];
    // Labeled by the site rather than printing the address, and named after
    // whose profile it is: two bare site labels say nothing about which
    // person or organization either one opens.
    expect([...container.querySelectorAll(".pk-link-list__label")].map((label) => label.textContent)).toEqual([
      "GitHub",
      "LinkedIn",
      "LinkedIn",
      "X (Twitter)",
    ]);
    expect(badges.map((link) => link.getAttribute("aria-label"))).toEqual([
      null,
      null,
      "Ada Lovelace on LinkedIn (opens in a new tab)",
      "Ada Lovelace on X (Twitter) (opens in a new tab)",
    ]);
    expect(badges[0]?.getAttribute("href")).toBe("https://github.com/example-corp");
    // The address is still reachable, as the link's own tooltip.
    expect(badges[0]?.getAttribute("title")).toBe("https://github.com/example-corp");

    // No link is repeated as a term in the pages list beside them.
    const list = container.querySelector("dl.pk-datalist");
    expect(terms(list!)).toEqual(["Member since", "Website"]);
  });

  it("names the representatives region and nests each person under it", async () => {
    const container = await mountView({
      identities: [
        {
          name: "Ada Lovelace",
          jobTitle: "Chief Engineer",
          bio: "Writes **compilers**.",
          photoUrl: null,
          links: [],
        },
        { name: "Grace Hopper", jobTitle: null, bio: null, photoUrl: "/assets/grace.jpg", links: [] },
      ],
    });

    const region = container.querySelector("section[aria-labelledby]");
    expect(region).not.toBeNull();
    const label = container.querySelector(`[id="${region!.getAttribute("aria-labelledby")!}"]`);
    expect(label?.textContent).toBe("Representatives");

    expect([...region!.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    // The bio is rendered markdown, not escaped source.
    expect(region!.querySelector("strong")?.textContent).toBe("compilers");
    // A portrait beside the name it belongs to is decorative; announcing the
    // name twice is worse than not announcing the picture at all.
    expect(region!.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("shows the branded initials, hidden from assistive technology, when there is no logo", async () => {
    const container = await mountView({ logoUrl: null, name: "Example Corp" });

    const initials = container.querySelector(".standalone-initials");
    expect(initials?.textContent).toBe("EC");
    expect(initials?.getAttribute("aria-hidden")).toBe("true");
    // The name is still on the page, as the heading rather than as a picture.
    expect(container.querySelector("h1")?.textContent).toContain("Example Corp");
  });

  it("leaves out the representatives region entirely when there are none", async () => {
    const container = await mountView({ identities: [] });

    expect(container.querySelector("section[aria-labelledby]")).toBeNull();
    expect(container.textContent).not.toContain("Representatives");
  });
});
