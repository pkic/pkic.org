// @vitest-environment jsdom
/**
 * The Board / Executive Council roster after its move onto the design system.
 *
 * The Bootstrap version drew each body as a `card` and each position as a
 * `d-flex` line of spans, so the four values in a row had no headers, the two
 * rosters had no names, and every row's menu was called the same thing. These
 * assert what replaced them: two captioned tables inside a named region, an
 * editor that opens as the row's own detail, and a load failure that is
 * announced rather than left blank.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  leadershipPositionResponseSchema,
  leadershipPositionUpdateSchema,
} from "../../assets/shared/schemas/leadership";
import { LeadershipPositions } from "../../assets/ts/member-flows/portal/sections/leadership/LeadershipPositions";

const POSITION_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const IDENTITY_ID = "44444444-4444-4444-8444-444444444444";

const chair = leadershipPositionResponseSchema.parse({
  id: POSITION_ID,
  body: "board",
  userId: USER_ID,
  identityId: IDENTITY_ID,
  organizationName: "Example Corp",
  name: "Ada Lovelace",
  email: "ada@example.test",
  title: "Chair",
  startsAt: "2022-06-01",
  endsAt: null,
  createdAt: "2022-06-01T00:00:00.000Z",
  updatedAt: "2022-06-01T00:00:00.000Z",
});

const retired = leadershipPositionResponseSchema.parse({
  ...chair,
  id: "55555555-5555-4555-8555-555555555555",
  name: "Grace Hopper",
  organizationName: null,
  title: "Treasurer",
  startsAt: "2018-01-01",
  endsAt: "2021-12-31",
});

function page(count: number) {
  return { limit: 50, offset: 0, total: count, hasMore: false };
}

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

interface Captured {
  method: string;
  pathname: string;
  body?: string;
}

/** Serves both rosters, the affiliation lookup, and the position update. */
function stubRoster(options: { listStatus?: number } = {}): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, location.origin);
      const method = init.method ?? "GET";
      captured.push({
        method,
        pathname: url.pathname,
        body: typeof init.body === "string" ? init.body : undefined,
      });

      if (url.pathname.endsWith("/affiliations")) {
        return json({
          affiliations: [
            {
              identityId: IDENTITY_ID,
              memberId: "66666666-6666-4666-8666-666666666666",
              organizationName: "Example Corp",
              membershipCategory: "A",
            },
          ],
        });
      }
      if (method === "PATCH") return json({ ...chair, title: "Vice Chair" });
      if (options.listStatus) {
        return json({ error: { code: "FORBIDDEN", message: "Not permitted" } }, options.listStatus);
      }
      const current = url.searchParams.get("status") === "current";
      return json({ positions: current ? [chair] : [retired], page: page(1) });
    }),
  );
  return captured;
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
}

function board(): ComponentChildren {
  return <LeadershipPositions body="board" label="Board of Directors" canGrant canRevoke />;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("leadership positions roster", () => {
  it("names the region, both tables, and every row's menu", async () => {
    stubRoster();
    const container = mount(board());
    await settle();

    const region = container.querySelector("section.pk-panel");
    expect(region?.getAttribute("aria-label")).toBe("Board of Directors");
    expect(region?.classList.contains("pk")).toBe(true);

    // Four tables on a page announced as "table, table, table, table" is the
    // failure this replaces.
    const captions = [...container.querySelectorAll("caption")].map((caption) => caption.textContent);
    expect(captions).toEqual(["Current Board of Directors", "Past Board of Directors"]);

    const headers = [...container.querySelectorAll("thead th")].map((cell) => cell.textContent);
    expect(headers.slice(0, 5)).toEqual(["Name", "Position", "Represents", "Term", "Actions"]);

    const firstRow = container.querySelector("tbody tr");
    expect(firstRow?.textContent).toContain("Ada Lovelace");
    expect(firstRow?.textContent).toContain("Example Corp");
    expect(firstRow?.textContent).toContain("Jun 1, 2022 – present");
    // A member with no organization represents themselves; the column never
    // goes blank.
    expect(container.textContent).toContain("Individual membership");

    // Each menu says whose row it belongs to, so two rows are two controls
    // rather than two buttons with one name.
    const menus = [...container.querySelectorAll("button[aria-haspopup=menu]")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(menus).toEqual(["Actions for Ada Lovelace", "Actions for Grace Hopper"]);

    // Nothing this surface renders is framework markup any more. The people
    // search it embeds is a shared component with its own migration, so its
    // own `form-control` input is not asserted against here.
    for (const legacy of [".card", ".card-body", ".form-select", ".form-check", ".d-flex", ".text-muted"]) {
      expect(container.querySelector(legacy), `${legacy} survived the migration`).toBeNull();
    }
  });

  it("announces a failed load instead of showing an empty roster", async () => {
    stubRoster({ listStatus: 403 });
    const container = mount(board());
    await settle();

    const alert = container.querySelector(".pk-alert--danger");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("Not permitted");
    expect(container.querySelector("table")).toBeNull();
  });

  it("opens the row's editor from its menu and sends the shared update contract", async () => {
    const captured = stubRoster();
    const container = mount(board());
    await settle();

    await click(container.querySelector('button[aria-label="Actions for Ada Lovelace"]'));
    const edit = [...container.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Edit position",
    );
    await click(edit);

    // The editor belongs to the row it edits, so it is the row's own detail
    // rather than a form that replaced the list.
    const detail = container.querySelector("tr.pk-table__detail");
    const form = detail?.querySelector("form");
    expect(form?.getAttribute("aria-label")).toBe("Edit Ada Lovelace's position");
    expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(2);

    const titleLabel = [...form!.querySelectorAll<HTMLLabelElement>("label.pk-field__label")].find((label) =>
      (label.textContent ?? "").startsWith("Title"),
    )!;
    const title = [...form!.querySelectorAll<HTMLInputElement>("input[id]")].find(
      (input) => input.id === titleLabel.htmlFor,
    )!;
    expect(title.value).toBe("Chair");
    expect(title.required).toBe(true);

    title.value = "Vice Chair";
    void act(() => {
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const patch = captured.find((request) => request.method === "PATCH");
    expect(patch?.pathname).toBe(`/api/v1/leadership/positions/${POSITION_ID}`);
    // The request is what the shared schema says it is, not what a literal
    // comparison in this file says it is.
    const sent = leadershipPositionUpdateSchema.parse(JSON.parse(patch!.body!));
    expect(sent.title).toBe("Vice Chair");
    expect(sent.identityId).toBe(IDENTITY_ID);
    expect(sent.startsAt).toBe("2022-06-01");
    expect(sent.endsAt).toBeNull();

    // Saving closes the editor.
    expect(container.querySelector("tr.pk-table__detail")).toBeNull();
  });
});
