// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupStatistics } from "../../assets/ts/member-flows/portal/sections/management/GroupStatistics";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

const baseStats = {
  group: {
    id: GROUP_ID,
    slug: "architecture",
    name: "Architecture",
    type: { key: "working_group", singularLabel: "Working group", pluralLabel: "Working groups" },
  },
  generatedAt: "2026-08-26T12:00:00.000Z",
  scope: "current" as const,
  window: { from: null, to: "2026-08-26T12:00:00.000Z" },
  participation: { people: { count: 2 }, capacities: { count: 3 } },
  activity: {
    people: { actorCount: 2, actionCount: 4 },
    capacities: { joinedCount: 1, leftCount: 0 },
  },
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<GroupStatistics groupId={GROUP_ID} />, container));
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

describe("portal group statistics", () => {
  it("shows loading state, server-defined person/capacity semantics, and UTC activity", async () => {
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    const container = mount();
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    resolveResponse(json(baseStats));
    await settle();
    expect(container.textContent).toContain("Distinct users");
    expect(container.textContent).toContain("Member participation rows");
    expect(container.textContent).toContain("Active people");
    expect(container.textContent).toContain("2026-08-26 12:00:00 UTC");
    expect(container.querySelector('[aria-label="People: 2"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Membership capacities: 3"]')).not.toBeNull();
    expect(container.textContent).toContain("Actions");
  });

  it("uses the shared schema-backed UTC window controls and sends filtering to D1", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return json({
          ...baseStats,
          scope: "historical",
          window: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-26T00:00:00.000Z" },
        });
      }),
    );
    const container = mount();
    await settle();
    const scope = container.querySelector<HTMLSelectElement>("#group-stats-scope")!;
    scope.value = "historical";
    await act(async () => {
      scope.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const from = container.querySelector<HTMLInputElement>("#group-stats-from")!;
    const to = container.querySelector<HTMLInputElement>("#group-stats-to")!;
    from.value = "2026-08-01";
    to.value = "2026-08-26";
    await act(async () => {
      from.dispatchEvent(new Event("input", { bubbles: true }));
      to.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await settle();

    const request = requests.at(-1)!;
    expect(request.pathname).toBe(`/api/v1/groups/${GROUP_ID}/stats`);
    expect(request.searchParams.get("scope")).toBe("historical");
    expect(request.searchParams.get("timezone")).toBe("UTC");
    expect(request.searchParams.get("from")).toBe("2026-08-01T00:00:00.000Z");
    expect(request.searchParams.get("to")).toBe("2026-08-26T00:00:00.000Z");
    expect(container.textContent).toContain("Historical window");
  });

  it("reports shared API errors and an explicit zero-activity state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Management required" } }, 403)),
    );
    const errorContainer = mount();
    await settle();
    expect(errorContainer.querySelector('[role="alert"]')?.textContent).toContain("Management required");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ...baseStats,
          participation: { people: { count: 0 }, capacities: { count: 0 } },
          activity: { people: { actorCount: 0, actionCount: 0 }, capacities: { joinedCount: 0, leftCount: 0 } },
        }),
      ),
    );
    const zeroContainer = mount();
    await settle();
    expect(zeroContainer.textContent).toContain("People");
    expect(zeroContainer.querySelector('[aria-label="People: 0"]')).not.toBeNull();
    expect(zeroContainer.textContent).toContain("No activity recorded in this UTC window.");
  });
});
