// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupGovernanceWidget } from "../../assets/ts/member-flows/leadership-widget";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function person(name: string, organizationName: string | null = "Example Member") {
  return {
    name,
    jobTitle: null,
    organizationName,
    organizationLogoUrl: null,
    organizationWebsite: organizationName ? "https://example.test" : null,
    photoUrl: null,
    featuredLink: null,
  };
}

const group = {
  id: "20000000-0000-4000-8000-000000000009",
  slug: "board",
  name: "Board of Directors",
  type: { key: "board", singularLabel: "Board", pluralLabel: "Boards" },
};

function directory(overrides: Record<string, unknown>) {
  return {
    group,
    mailingListEmail: null,
    leadership: [
      {
        roleId: "role-group_lead",
        title: "Chair",
        startsAt: "2025-03-01T00:00:00.000Z",
        endsAt: null,
        person: person("Chris Bailey"),
        sourceGroup: group,
        inherited: false,
      },
    ],
    pastLeadership: [
      {
        roleId: "role-group_lead",
        title: "Chair",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
        person: person("Kirk Hall", "Entrust"),
        sourceGroup: group,
        inherited: false,
      },
    ],
    roster: {
      current: [
        { person: person("Chris Bailey"), title: "Chair", startsAt: "2025-03-01T00:00:00.000Z", endsAt: null },
        {
          person: person("Mads Henriksveen", "Buypass"),
          title: "Member",
          startsAt: "2022-06-01T00:00:00.000Z",
          endsAt: null,
        },
      ],
      past: [
        {
          person: person("Former Member", "Harica"),
          title: "Member",
          startsAt: "2022-06-01T00:00:00.000Z",
          endsAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let container: HTMLDivElement;

async function mountWidget(view: "roster" | "leadership"): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(
      <GroupGovernanceWidget
        apiBase="/api/v1"
        slug="board"
        view={view}
        color="green"
        pastHeadingHtml="<h2>Previous Board members</h2>"
      />,
      container,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
}

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

describe("GroupGovernanceWidget", () => {
  it("renders the published roster with leaders first and a merged past-positions timeline", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBe("/api/v1/groups/board/directory");
      return json(directory({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountWidget("roster");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("h2")?.textContent).toBe("Previous Board members");
    const cards = [...container.querySelectorAll('[data-positions="current"] .person-card')];
    expect(cards.map((card) => card.querySelector(".person-card-name")?.textContent)).toEqual([
      "Chris Bailey",
      "Mads Henriksveen",
    ]);
    expect(cards[0]?.textContent).toContain("Chair");
    expect(cards[0]?.textContent).toContain("In role sinceMar 1, 2025");
    expect(cards[1]?.textContent).toContain("Member");
    /*
     * A past position is the same tile as a sitting one, in the same grid,
     * with the closed term and the grey ring as the whole difference — issue
     * #25: "the content does not render to a tile like the active board
     * members".
     */
    const pastCards = [...container.querySelectorAll('[data-positions="past"] .person-card')];
    // Most recently ended first: the former member (2026) before the former chair (2025).
    expect(pastCards.map((card) => card.querySelector(".person-card-name")?.textContent)).toEqual([
      "Former Member",
      "Kirk Hall",
    ]);
    expect(pastCards.every((card) => card.classList.contains("person-card--past"))).toBe(true);
    expect(container.querySelectorAll('[data-positions="past"] .person-card-avatar-frame--past')).toHaveLength(2);
    expect(pastCards[1]?.textContent).toContain("Jun 1, 2022 – Feb 1, 2025");
  });

  it("renders only leadership when asked, so the About page shows the chair and vice chair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(directory({}))),
    );
    await mountWidget("leadership");

    const names = [...container.querySelectorAll('[data-positions="current"] .person-card-name')].map(
      (name) => name.textContent,
    );
    expect(names).toEqual(["Chris Bailey"]);
    expect(container.textContent).not.toContain("Mads Henriksveen");
    expect(container.textContent).not.toContain("Former Member");
    expect(container.textContent).toContain("Kirk Hall");
  });

  /*
   * Issue #19: the About page said "In role since Invalid Date" and told the
   * reader where a chair works rather than what they are. The term comes from
   * the assignment's own start date now, and the line under the name says the
   * title when the profile carries no job title of its own — the employer is
   * the organization block below it, said once.
   */
  function onlyLeader(overrides: Record<string, unknown>) {
    return directory({
      pastLeadership: [],
      leadership: [
        {
          roleId: "role-group_lead",
          title: "Chair",
          startsAt: "2025-03-01T00:00:00.000Z",
          endsAt: null,
          person: person("Chris Bailey", "Entrust"),
          sourceGroup: group,
          inherited: false,
          ...overrides,
        },
      ],
    });
  }

  it("says what a leader is where it used to say where they work", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(onlyLeader({ title: "Vice Chair" }))),
    );
    await mountWidget("leadership");

    const card = container.querySelector(".consortium-leaders .person-card");
    expect(card?.querySelector(".person-card-jobtitle")?.textContent).toBe("Vice Chair");
    expect(container.querySelector("h2")).toBeNull();
    // The company is still attributed, once, by the organization block.
    expect(card?.querySelector(".person-card-org")?.textContent).toContain("Entrust");
    expect(card?.querySelector(".person-card-jobtitle")?.textContent).not.toContain("Entrust");
  });

  it("keeps a person's own job title when the profile carries one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(onlyLeader({ person: { ...person("Chris Bailey", "Entrust"), jobTitle: "VP Standards" } })),
      ),
    );
    await mountWidget("leadership");

    const card = container.querySelector(".consortium-leaders .person-card");
    expect(card?.querySelector(".person-card-jobtitle")?.textContent).toBe("VP Standards");
    expect(card?.textContent).not.toContain("VP Standards at Entrust");
  });

  it("says nothing about a term it cannot read rather than 'In role since Invalid Date'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(onlyLeader({ startsAt: "not-a-date" }))),
    );
    await mountWidget("leadership");

    expect(container.textContent).toContain("Chris Bailey");
    expect(container.textContent).not.toContain("Invalid Date");
    expect(container.textContent).not.toContain("In role since");
  });

  it("keeps a profile link off the name's own line", async () => {
    /*
     * Issue #13 again, as a layout fault rather than a missing badge: the
     * link sat in a row beside the name that could not wrap, so a chair with
     * a LinkedIn badge had their name squeezed sideways and the card next to
     * them, with no link, did not line up.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          onlyLeader({
            person: {
              ...person("Chris Bailey", "Entrust"),
              featuredLink: "https://www.linkedin.com/in/chris",
            },
          }),
        ),
      ),
    );
    await mountWidget("leadership");

    const card = container.querySelector(".consortium-leaders .person-card");
    const name = card?.querySelector(".person-card-name");
    expect(name?.textContent).toBe("Chris Bailey");
    // The badge is in the card, and it is not a sibling sharing the name's row.
    const link = card?.querySelector('a[href="https://www.linkedin.com/in/chris"]');
    expect(link).not.toBeNull();
    expect(name?.parentElement?.contains(link ?? null)).toBe(true);
    expect(link?.parentElement).not.toBe(name?.parentElement);
    expect(card?.querySelector(".person-card-name-row")).toBeNull();
  });

  it("draws a representative with no organization as a card, not as a broken one", async () => {
    /*
     * Issue #25's second half. A seat holder tied to no organization — and
     * with no photograph and no profile link — is a real state: the public
     * directory has to publish the seat without pretending to facts it does
     * not have. Nothing is left half-rendered: no empty organization block,
     * no dangling "at", initials in place of the portrait.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          directory({
            leadership: [],
            pastLeadership: [
              {
                roleId: "role-group_lead",
                title: "Chair",
                startsAt: "2022-06-01T00:00:00.000Z",
                endsAt: "2025-02-01T00:00:00.000Z",
                person: person("Unaffiliated Chair", null),
                sourceGroup: group,
                inherited: false,
              },
            ],
            roster: null,
          }),
        ),
      ),
    );
    await mountWidget("roster");

    const card = container.querySelector('[data-positions="past"] .person-card');
    expect(card?.querySelector(".person-card-name")?.textContent).toBe("Unaffiliated Chair");
    expect(card?.querySelector(".person-card-org")).toBeNull();
    expect(card?.textContent).not.toContain(" at ");
    // Initials rather than an empty ring where the photograph would go.
    expect(card?.querySelector(".person-card-avatar--initials")?.textContent).toBe("UC");
    expect(card?.textContent).toContain("Jun 1, 2022 – Feb 1, 2025");
  });

  it("renders nothing when the group publishes neither a roster nor leadership", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(directory({ leadership: [], pastLeadership: [], roster: null }))),
    );
    await mountWidget("roster");
    expect(container.textContent).toBe("");
  });

  it("fails closed when the directory request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("directory unavailable"))),
    );
    await mountWidget("roster");
    expect(container.textContent).toBe("");
  });
});
