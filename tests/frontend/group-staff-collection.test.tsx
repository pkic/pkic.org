// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Groups } from "../../assets/ts/member-flows/portal/sections/Groups";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { group } from "./helpers/self-group-fixture";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/groups", vi.fn()],
}));

const mounted: HTMLElement[] = [];

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  portalSession.value = null;
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("staff groups collection", () => {
  it("stays quiet for an active group and only badges the inactive one", async () => {
    portalSession.value = portalSessionFixture({ staff: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              groups: [
                group({
                  id: "10000000-0000-4000-8000-000000000010",
                  slug: "pqc",
                  name: "Architecture Group",
                  active: true,
                }),
                group({
                  id: "10000000-0000-4000-8000-000000000011",
                  abbreviatedName: "RET",
                  name: "Retired Group",
                  active: false,
                }),
              ],
              page: { limit: 25, offset: 0, total: 2, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<Groups />, container));
    await settle();

    const rows = [...container.querySelectorAll("tbody tr")];
    const activeRow = rows.find((row) => row.textContent?.includes("Architecture Group"));
    const inactiveRow = rows.find((row) => row.textContent?.includes("Retired Group"));
    if (!activeRow || !inactiveRow) throw new Error("missing expected group rows");
    expect(activeRow.querySelector(".pk-table__coded-label")).toBeNull();
    expect(activeRow.querySelector(".pk-table__clamp")?.textContent).toBe("Architecture Group");
    expect(activeRow.querySelector(".pk-table__clamp")?.getAttribute("title")).toBe("Architecture Group");
    expect(inactiveRow.querySelector(".pk-table__coded-label__code")?.textContent).toBe("RET");
    expect(inactiveRow.querySelector(".pk-table__coded-label__separator")?.textContent?.trim()).toBe("|");

    // An active group is quiet on the page — no pill — but not silent to a
    // screen reader: the dash that stands in for the badge is decoration, and
    // the word beside it is what carries the state.
    expect(activeRow.querySelector(".pk-badge")).toBeNull();
    expect(activeRow.querySelector(".pk-table__value > [aria-hidden='true']")?.textContent).toBe("—");
    expect(activeRow.querySelector(".pk-sr-only")?.textContent).toBe("Active");
    expect(inactiveRow.querySelector(".pk-badge")?.textContent).toBe("Inactive");
  });

  it("names the staff table and its region, so it is not one card among several unnamed ones", async () => {
    portalSession.value = portalSessionFixture({ staff: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              groups: [group({ id: "10000000-0000-4000-8000-000000000012", name: "Architecture Group" })],
              page: { limit: 25, offset: 0, total: 1, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<Groups />, container));
    await settle();

    // The table names itself through its caption; the panel wrapper that
    // used to carry a duplicate name is gone with the width cap.
    expect(container.querySelector("caption")?.textContent).toBe("All groups");
    // The row is activated by a real link, not a handler on the `<tr>`.
    const rowLink = container.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link");
    expect(rowLink?.textContent).toBe("Open Architecture Group");
    expect(rowLink?.getAttribute("href")).toContain("/groups/10000000-0000-4000-8000-000000000012/overview");
  });

  it("announces a failed member catalog as a sentence rather than an empty column", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<Groups />, container));
    await settle();

    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Online services are temporarily unavailable.");
  });

  it("says the catalog is empty in an announced region rather than a muted line", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ groups: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<Groups />, container));
    await settle();

    const empty = container.querySelector("[role='status']");
    expect(empty?.textContent).toContain("No groups are available right now.");
  });
});
