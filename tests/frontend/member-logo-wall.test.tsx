// @vitest-environment jsdom
/**
 * The social card's member wall, read from the membership rather than a file.
 *
 * `all.og-card.html` collected these logos at Hugo build time — the members
 * section's own pages plus `assets/images/members/`, and
 * `hugo.Data.members` filtered on a `workingGroups` field — so a card showed
 * whoever was in a YAML file, with whatever logo the repository happened to
 * carry (#8). What is asserted here is what a screenshot cannot show: that
 * the wall asks the canonical roll, narrows to a working group when there is
 * one, leaves out a member with no logo rather than drawing a gap, and puts
 * the same card in the same order every time it is captured.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberLogoWall } from "../../assets/ts/member-flows/member-logo-wall";

const REQUESTS: string[] = [];

function member(id: string, name: string, logoUrl: string | null) {
  return {
    id,
    slug: name.toLowerCase(),
    name,
    memberType: "A",
    tier: null,
    memberSince: "2020-01-01",
    website: null,
    description: null,
    slogan: null,
    logoUrl,
  };
}

const ROLL = [
  member("1", "Alpha", "/logos/alpha.svg"),
  member("2", "Bravo", "/logos/bravo.svg"),
  member("3", "Charlie", null),
  member("4", "Delta", "/logos/delta.svg"),
];

let host: HTMLElement;

beforeEach(() => {
  REQUESTS.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      REQUESTS.push(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({ members: ROLL, page: { limit: 120, offset: 0, total: ROLL.length, hasMore: false } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(workingGroup?: string): Promise<void> {
  await act(async () => {
    render(
      <MemberLogoWall
        apiBase="/api/v1"
        workingGroup={workingGroup}
        containerClass="og-member-wall-bg"
        logoClass="og-member-logo"
      />,
      host,
    );
  });
  // The read resolves across several microtasks (fetch, then the response
  // body, then the schema parse), so the mount is settled rather than flushed
  // once.
  for (let tick = 0; tick < 10; tick += 1) await act(async () => Promise.resolve());
}

function logos(): string[] {
  return [...host.querySelectorAll("img")].map((image) => image.getAttribute("src") ?? "");
}

describe("the social card's member logo wall", () => {
  it("reads the canonical roll, one row per member", async () => {
    await mount();
    expect(REQUESTS).toHaveLength(1);
    const url = new URL(REQUESTS[0], "https://example.test");
    // A member, not a seat: representatives inherit a membership, so the roll
    // is asked for organizations rather than for people.
    expect(url.pathname).toBe("/api/v1/members");
    expect(url.searchParams.get("group")).toBe("organization");
    expect(url.searchParams.get("workingGroup")).toBeNull();
  });

  it("narrows to a working group when the card is a group's", async () => {
    await mount("pqc");
    expect(new URL(REQUESTS[0], "https://example.test").searchParams.get("workingGroup")).toBe("pqc");
  });

  it("leaves out a member with no logo rather than drawing a gap", async () => {
    await mount();
    expect(logos()).toHaveLength(3);
    expect(logos()).not.toContain("");
    expect(host.querySelectorAll(".og-member-logo")).toHaveLength(3);
  });

  it("arranges the same card the same way every capture", async () => {
    await mount();
    const first = logos();
    expect(first.length).toBeGreaterThan(1);
    render(null, host);
    await mount();
    // A social card is captured repeatedly and compared with its previous
    // capture. Hugo's `shuffle` reordered the wall on every build, which made
    // every card look changed; the order is seeded on the wall's subject now.
    expect(logos()).toEqual(first);
  });

  it("renders nothing at all when the roll cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await mount();
    expect(host.querySelector(".og-member-wall-bg")).toBeNull();
  });
});
