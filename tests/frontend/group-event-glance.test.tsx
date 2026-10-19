// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { CollectionTotals } from "../../assets/ts/components/CollectionTotals";
import { GroupEventGlance } from "../../assets/ts/member-flows/portal/sections/management/GroupEventGlance";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
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

const EVENT = { id: "event-1", slug: "pqc-2026" } as GroupEvent;
const page = (total: number) => ({ limit: 1, offset: 0, total, hasMore: total > 1 });
const eventSummary = { id: "event-1", slug: "pqc-2026", name: "PQC 2026" };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function stubEndpoints({ published }: { published: number }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname.endsWith("/registrations")) {
        return json({
          registrations: [],
          page: page(2880),
          event: eventSummary,
          stats: { byStatus: { registered: 2880, cancelled: 4 }, byAttendanceType: {}, attendanceStatusByType: {} },
        });
      }
      if (url.pathname.endsWith("/proposals")) {
        return json({
          proposals: [],
          page: page(0),
          event: eventSummary,
          access: {
            eventPermissions: ["proposals:read"],
            canRead: true,
            canReview: false,
            canFinalize: false,
            canEditAcceptedAbstract: false,
            canCancelAcceptedProposal: false,
          },
          stats: { byStatus: { accepted: 3 }, byRecommendation: {}, reviewedCount: 3, unreviewedCount: 0, total: 3 },
        });
      }
      if (url.pathname.endsWith("/agenda/occurrences")) {
        return json({
          occurrences: [],
          page: page(url.searchParams.get("publicationStatus") === "published" ? published : 12),
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

function figures(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(".pk-stat-card")].map((card) => ({
    label: card.querySelector(".pk-stat-card__label")?.textContent,
    value: card.querySelector(".pk-stat-card__value")?.textContent,
    note: card.querySelector(".pk-stat-card__note")?.textContent ?? undefined,
    toned: /pk-stat-card--(warn|ok|accent)/.test(card.className),
    href: card.querySelector("a")?.getAttribute("href"),
  }));
}

describe("group event overview at a glance", () => {
  it("leads with grouped counts that link to their tabs, tinting only a queue with something in it", async () => {
    stubEndpoints({ published: 9 });
    const container = mount(
      <GroupEventGlance
        event={EVENT}
        groupId="group-1"
        visibleTabs={new Set(["registrations", "proposals", "agenda"])}
        tabHref={(tab) => `#/events/${tab}`}
      />,
    );
    await settle();
    await settle();

    expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Event at a glance");
    expect(figures(container)).toEqual([
      {
        label: "Registrations",
        value: (2880).toLocaleString(),
        note: undefined,
        toned: false,
        href: "#/events/registrations",
      },
      { label: "Proposals to review", value: "0", note: undefined, toned: false, href: "#/events/proposals" },
      { label: "Agenda", value: "Changes to publish", note: "3 of 12 sessions", toned: true, href: "#/events/agenda" },
    ]);
  });

  it("draws only the figures whose tab the reader can open", async () => {
    stubEndpoints({ published: 12 });
    const container = mount(
      <GroupEventGlance
        event={EVENT}
        groupId="group-1"
        visibleTabs={new Set(["agenda"])}
        tabHref={(tab) => `#/events/${tab}`}
      />,
    );
    await settle();
    await settle();
    expect(figures(container).map((figure) => [figure.label, figure.value])).toEqual([["Agenda", "Published"]]);
  });
});

describe("collection totals", () => {
  it("groups each count and keeps a state's tone for counts above zero", () => {
    const container = mount(
      <CollectionTotals
        label="Totals"
        items={[
          { label: "total", value: 2880 },
          { label: "needs work", value: 0, tone: "warn" },
          { label: "no reviews", value: 5, tone: "warn" },
        ]}
      />,
    );
    const cards = [...container.querySelectorAll<HTMLElement>(".pk-stat-card")];
    expect(cards.map((card) => card.querySelector(".pk-stat-card__value")?.textContent)).toEqual([
      (2880).toLocaleString(),
      "0",
      "5",
    ]);
    expect(cards.map((card) => card.classList.contains("pk-stat-card--warn"))).toEqual([false, false, true]);
  });
});
