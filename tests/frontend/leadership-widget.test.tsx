// @vitest-environment jsdom
/**
 * The public leadership rosters and the person card they render.
 *
 * What a visual review of these cannot check: whether each control has a name
 * that tells it apart from the nine identical ones beside it, whether the
 * photo repeats the name a screen reader is about to read anyway, and what
 * the widget does when the endpoint behind it does not answer.
 *
 * Fixtures are parsed through the shared response schemas on the way out,
 * because that is what `getJson` parses on the way in.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consortiumChairsPublicResponseSchema,
  leadershipPublicResponseSchema,
} from "../../assets/shared/schemas/leadership";
import { publicOrganizationPersonSchema } from "../../assets/shared/schemas/public-person";
import { ConsortiumWidget, RosterWidget } from "../../assets/ts/member-flows/leadership-widget";
import { PublicPersonCard } from "../../assets/ts/member-flows/components/public-person-card";

const mounted: HTMLElement[] = [];

type PersonPayload = Record<string, unknown>;

function person(overrides: PersonPayload = {}): PersonPayload {
  return {
    name: "Ada Lovelace",
    jobTitle: "Chief Cryptographer",
    organizationName: "Analytical Engines Ltd",
    organizationLogoUrl: null,
    organizationWebsite: "https://engines.example/",
    photoUrl: "https://cdn.example/ada.jpg",
    linkedin: "https://www.linkedin.com/in/ada/",
    ...overrides,
  };
}

function position(overrides: PersonPayload = {}): PersonPayload {
  return { ...person(), title: "Chair", startsAt: "2025-01-01", endsAt: null, ...overrides };
}

/** The card takes a parsed record, so the fixture goes through the contract. */
function personRecord(overrides: PersonPayload = {}) {
  return publicOrganizationPersonSchema.parse(person(overrides));
}

function stubJson(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
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

async function mount(node: Parameters<typeof render>[0]): Promise<HTMLElement> {
  const container = attach();
  await act(() => render(node, container));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public person card", () => {
  it("names the profile link after the person rather than after the network", async () => {
    const container = await mount(
      <PublicPersonCard person={personRecord()} role="Chair" color="green" from="2025-01-01" />,
    );

    const link = container.querySelector<HTMLAnchorElement>("a.person-card-linkedin");
    // Ten cards on a page would otherwise offer ten links all called
    // "LinkedIn", which is nothing to choose between out of context.
    expect(link?.getAttribute("aria-label")).toBe("Ada Lovelace on LinkedIn");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not make the photo repeat the name printed beside it", async () => {
    const container = await mount(
      <PublicPersonCard person={personRecord()} role="Chair" color="green" from="2025-01-01" />,
    );

    expect(container.querySelector<HTMLImageElement>("img.person-card-avatar")?.alt).toBe("");
    expect(container.querySelector(".person-card-name")?.textContent).toBe("Ada Lovelace");
  });

  it("renders initials, and no profile link at all, for a person with neither photo nor LinkedIn", async () => {
    const container = await mount(
      <PublicPersonCard
        person={personRecord({ photoUrl: null, linkedin: null })}
        role="Chair"
        color="green"
        from="2025-01-01"
      />,
    );

    expect(container.querySelector(".person-card-avatar--initials")?.textContent).toBe("AL");
    // A control that does nothing when activated is worse than no control.
    expect(container.querySelector("a.person-card-linkedin")).toBeNull();
  });
});

describe("public leadership widgets", () => {
  it("renders the current roster and the past timeline from one bounded request", async () => {
    const fetchMock = stubJson(
      leadershipPublicResponseSchema.parse({
        current: [position()],
        past: [position({ name: "Grace Hopper", title: "Vice Chair", startsAt: "2020-01-01", endsAt: "2024-12-31" })],
      }),
    );

    const container = await mount(<RosterWidget apiBase="/api/v1" body="board" color="green" />);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/v1/leadership/board");
    expect(container.querySelector(".consortium-past-heading")?.textContent).toBe("Past positions");
    expect(container.querySelector(".person-tl-name")?.textContent).toBe("Grace Hopper");
    // The timeline photo does not repeat the name that follows it either.
    expect(container.querySelector<HTMLImageElement>("img.person-tl-avatar")?.alt).toBe("");
  });

  it("renders nothing rather than an empty frame when the roster request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    const container = await mount(<RosterWidget apiBase="/api/v1" body="board" color="green" />);

    // A marketing page keeps its shape when the endpoint behind a widget is
    // unavailable: the widget withdraws instead of leaving a broken region.
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the consortium has neither chair nor vice chair published", async () => {
    stubJson(consortiumChairsPublicResponseSchema.parse({ chair: null, viceChair: null }));

    const container = await mount(<ConsortiumWidget apiBase="/api/v1" color="green" />);

    expect(container.innerHTML).toBe("");
  });

  it("names both consortium chairs by their role", async () => {
    stubJson(
      consortiumChairsPublicResponseSchema.parse({
        chair: { ...person(), startsAt: "2025-01-01" },
        viceChair: { ...person({ name: "Grace Hopper" }), startsAt: "2025-01-01" },
      }),
    );

    const container = await mount(<ConsortiumWidget apiBase="/api/v1" color="green" />);

    expect([...container.querySelectorAll(".person-card-role-arc")].map((role) => role.textContent)).toEqual([
      "Chair",
      "Vice Chair",
    ]);
    expect(
      [...container.querySelectorAll("a.person-card-linkedin")].map((link) => link.getAttribute("aria-label")),
    ).toEqual(["Ada Lovelace on LinkedIn", "Grace Hopper on LinkedIn"]);
  });
});
