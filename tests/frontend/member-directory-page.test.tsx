// @vitest-environment jsdom
/**
 * The public member directory: what it asks the API for, what it renders for
 * each result shape, and — the part a screenshot cannot check — what the
 * search form and the empty state expose to someone not looking at it.
 *
 * Fixtures go out through `membersListResponseSchema`, the same contract
 * `getJson` parses on the way in, so a payload that drifts from the shared
 * schema fails here rather than passing against a shape no endpoint sends.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberDirectory } from "../../assets/ts/member-flows/member-directory-page";
import { membersListResponseSchema } from "../../assets/shared/schemas/members-directory";
import { buttonNamed, controlFor, typeInto } from "./helpers/labelled-control";

const mounted: HTMLElement[] = [];

type MemberPayload = Record<string, unknown>;

function member(overrides: MemberPayload = {}): MemberPayload {
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
    ...overrides,
  };
}

/** The listing as the endpoint would send it, contract-checked on the way out. */
function listingResponse(members: MemberPayload[]): string {
  return JSON.stringify(
    membersListResponseSchema.parse({
      members,
      page: { limit: 50, offset: 0, total: members.length, hasMore: false },
    }),
  );
}

function stubFetch(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(body, { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountDirectory(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() => {
    render(
      <MemberDirectory
        apiBase="/api/v1"
        group="organization"
        prefix="m"
        label="members"
        detailBase="/members/profile/"
      />,
      container,
    );
  });
  // The fetch starts in an effect, so let its microtasks drain.
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

describe("public member directory", () => {
  it("names the search control through a for/id pair rather than a placeholder", async () => {
    stubFetch(listingResponse([member()]));

    const container = await mountDirectory();

    // Resolved through the label's `for` and the input's `id`, so the lookup
    // fails exactly when the labeling contract is broken.
    const search = controlFor(container, "Search members");
    expect(search.tagName).toBe("INPUT");
    expect(search.getAttribute("type")).toBe("search");
    expect(search.id).not.toBe("");
    // The form's own region opts into the base layer; the legacy-styled grid
    // below it deliberately does not.
    expect(container.querySelector("form")?.classList.contains("pk")).toBe(true);
  });

  it("sends the typed term as the q parameter on submit", async () => {
    const fetchMock = stubFetch(listingResponse([member()]));

    const container = await mountDirectory();
    await typeInto(controlFor(container, "Search members"), "  example  ");
    await act(async () => {
      buttonNamed(container, "Search").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => new URL(url, "https://test.local").searchParams.get("q") === "example")).toBe(true);
  });

  it("announces an empty result instead of leaving the grid blank", async () => {
    stubFetch(listingResponse([]));

    const container = await mountDirectory();

    const status = container.querySelector('[role="status"].pk-empty-state');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("No members found.");
    // No rail to scan and no cards to scan it against.
    expect(container.querySelector(".members-az-sidebar")).toBeNull();
  });

  it("states a failed listing as a sentence in an alert, not as a status code", async () => {
    stubFetch(JSON.stringify({ error: "nope" }), 500);

    const container = await mountDirectory();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Something went wrong on our side.");
    expect(alert?.textContent).not.toContain("HTTP 500");
    expect(container.querySelector("form")).toBeNull();
  });

  it("makes each card's whole area one named link rather than a click handler", async () => {
    stubFetch(listingResponse([member()]));

    const container = await mountDirectory();

    const link = container.querySelector<HTMLAnchorElement>(".member-card a.pk-stretched");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("aria-label")).toBe("Example Corp");
    expect(link?.getAttribute("href")).toBe("/members/example-corp/");
  });
});
