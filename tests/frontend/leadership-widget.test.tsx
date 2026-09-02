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
    linkedin: null,
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
    render(<GroupGovernanceWidget apiBase="/api/v1" slug="board" view={view} color="green" />, container);
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
    const cards = [...container.querySelectorAll(".consortium-leaders .person-card")];
    expect(cards.map((card) => card.querySelector(".person-card-name")?.textContent)).toEqual([
      "Chris Bailey",
      "Mads Henriksveen",
    ]);
    expect(cards[0]?.textContent).toContain("Chair");
    expect(cards[0]?.textContent).toContain("In role sinceMar 2025");
    expect(cards[1]?.textContent).toContain("Member");
    const timeline = [...container.querySelectorAll(".consortium-past-timeline .person-tl-item")];
    // Most recently ended first: the former member (2026) before the former chair (2025).
    expect(timeline.map((item) => item.querySelector(".person-tl-name")?.textContent)).toEqual([
      "Former Member",
      "Kirk Hall",
    ]);
    expect(timeline[1]?.textContent).toContain("Jun 2022 – Feb 2025");
  });

  it("renders only leadership when asked, so the About page shows the chair and vice chair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(directory({}))),
    );
    await mountWidget("leadership");

    const names = [...container.querySelectorAll(".consortium-leaders .person-card-name")].map(
      (name) => name.textContent,
    );
    expect(names).toEqual(["Chris Bailey"]);
    expect(container.textContent).not.toContain("Mads Henriksveen");
    expect(container.textContent).not.toContain("Former Member");
    expect(container.textContent).toContain("Kirk Hall");
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
