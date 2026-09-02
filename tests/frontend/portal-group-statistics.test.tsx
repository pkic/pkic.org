// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateTime } from "../../assets/shared/format-date";
import { GroupStatistics } from "../../assets/ts/member-flows/portal/sections/management/GroupStatistics";
import { groupStatsQuerySchema } from "../../assets/shared/schemas/group-statistics";
import { chooseOption, controlFor, submitForm, typeInto } from "./helpers/labelled-control";

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

/**
 * The number a named stat card reports.
 *
 * The label and the value are separate elements inside the card, so reading
 * the pair is what proves the number is attached to the name a reader hears
 * beside it rather than merely present somewhere on the page.
 */
function statValue(root: ParentNode, label: string): string {
  const card = [...root.querySelectorAll(".pk-stat-card")].find(
    (candidate) => candidate.querySelector(".pk-stat-card__label")?.textContent?.trim() === label,
  );
  if (!card) throw new Error(`no stat card is labelled "${label}"`);
  return card.querySelector(".pk-stat-card__value")?.textContent?.trim() ?? "";
}

/** The element a control points at with `aria-describedby`. */
function describedBy(control: HTMLElement, root: ParentNode): Element | null {
  const id = control.getAttribute("aria-describedby");
  return id ? root.querySelector(`[id="${id}"]`) : null;
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
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading group statistics");

    resolveResponse(json(baseStats));
    await settle();
    expect(container.textContent).toContain("Distinct people");
    expect(container.textContent).toContain("One per Member represented");
    expect(statValue(container, "People")).toBe("2");
    expect(statValue(container, "Memberships")).toBe("3");
    expect(statValue(container, "Active people")).toBe("2");
    expect(statValue(container, "Actions")).toBe("4");
    // Instants render through the shared localized formatter, never as raw
    // ISO strings pinned to UTC.
    expect(container.textContent).toContain(formatDateTime("2026-08-26T12:00:00.000Z"));
    expect(container.textContent).not.toContain("2026-08-26T12:00:00.000Z");
  });

  it("names every window control through a for/id pair and names each region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(baseStats)),
    );
    const container = mount();
    await settle();

    // `controlFor` resolves through the label's `for` and the control's `id`,
    // so it throws exactly when that pair is broken.
    expect(controlFor<HTMLSelectElement>(container, "Count people who").tagName).toBe("SELECT");
    expect(controlFor(container, "From").getAttribute("type")).toBe("date");
    expect(controlFor(container, "To").getAttribute("type")).toBe("date");

    const from = controlFor(container, "From");
    expect(describedBy(from, container)?.textContent).toContain("beginning of available history");

    const regions = [...container.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"));
    expect(regions).toEqual(["Reporting window", "Participation", "Activity"]);
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
    await chooseOption(controlFor<HTMLSelectElement>(container, "Count people who"), "historical");
    await typeInto(controlFor(container, "From"), "2026-08-01");
    await typeInto(controlFor(container, "To"), "2026-08-26");
    await submitForm(container);
    await settle();

    const request = requests.at(-1)!;
    expect(request.pathname).toBe(`/api/v1/groups/${GROUP_ID}/stats`);
    // The query the surface put on the wire has to satisfy the same contract
    // the route parses it with; comparing strings would only restate the code.
    expect(groupStatsQuerySchema.parse(Object.fromEntries(request.searchParams))).toEqual({
      scope: "historical",
      timezone: "UTC",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-26T00:00:00.000Z",
    });
    expect(container.textContent).toContain("Participated during the window");
  });

  it("marks the offending boundary invalid rather than issuing a request", async () => {
    const fetchMock = vi.fn(async () => json(baseStats));
    vi.stubGlobal("fetch", fetchMock);
    const container = mount();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await typeInto(controlFor(container, "From"), "2026-08-26");
    await typeInto(controlFor(container, "To"), "2026-08-01");
    await submitForm(container);
    await settle();

    // A window that ends before it starts is rejected by the shared schema on
    // the `to` path, so that is the control that carries the error.
    const to = controlFor(container, "To");
    expect(to.closest(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);
    expect(to.getAttribute("aria-invalid")).toBe("true");
    const message = describedBy(to, container);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("to must be later than from");
    expect(controlFor(container, "From").getAttribute("aria-invalid")).toBeNull();
    // The refused control takes focus, and the form says the window was not
    // applied.
    expect(document.activeElement).toBe(to);
    expect(container.querySelector(".pk-alert--danger")?.textContent).toContain("Please correct");
    // The rejected window never reached the server.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Corrected: the boundary says it is good now, the form-level message
    // goes, and the window is applied.
    await typeInto(to, "2026-08-27");
    expect(to.closest(".pk-field")?.classList.contains("pk-field--ok")).toBe(true);
    await submitForm(container);
    await settle();
    expect(container.querySelector(".pk-alert--danger")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(statValue(zeroContainer, "People")).toBe("0");
    const empty = zeroContainer.querySelector(".pk-empty-state");
    expect(empty?.getAttribute("role")).toBe("status");
    expect(empty?.textContent).toContain("No activity recorded in this window.");
  });
});
