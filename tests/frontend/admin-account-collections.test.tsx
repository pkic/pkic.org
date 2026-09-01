// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserRoles } from "../../assets/ts/member-flows/portal/sections/access-control/UserRoles";
import { UserEmailAddressesPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserAccountPanels";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000002";
const EMAIL_ID = "00000000-0000-4000-8000-000000000003";
const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(delay = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, delay));
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function page(url: URL, total: number, rowCount: number) {
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return { limit, offset, total, hasMore: offset + rowCount < total };
}

function dispatchInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  void act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal access-control collection pagination", () => {
  it("loads user role history through the page envelope and exposes search and final-page navigation", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        if (url.pathname === "/api/v1/permissions/subjects") {
          return jsonResponse({
            users: [
              {
                id: USER_ID,
                email: "history@example.test",
                first_name: "History",
                last_name: "User",
                organization_name: null,
                role: "user",
                active: 1,
                created_at: "2026-01-01T00:00:00.000Z",
                member_id: null,
                member_category: null,
                member_status: null,
                member_organization_id: null,
                member_organization_name: null,
                links: [],
                membership: null,
                type: "contact_only",
                eventParticipationCount: 0,
              },
            ],
            page: page(url, 1, 1),
          });
        }
        if (url.pathname === "/api/v1/roles") {
          return jsonResponse({
            roles: [
              {
                id: "role-membership_processor",
                name: "membership_processor",
                description: null,
                isSystemRole: true,
                permissions: [],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            page: page(url, 1, 1),
          });
        }
        if (url.pathname === `/api/v1/users/${USER_ID}/roles`) {
          return jsonResponse({
            roles: [
              {
                id: ASSIGNMENT_ID,
                userId: USER_ID,
                roleId: "role-membership_processor",
                roleName: "membership_processor",
                contextType: null,
                contextId: null,
                expiresAt: "2020-01-01T00:00:00.000Z",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            page: page(url, 26, 1),
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const container = mount(<UserRoles />);
    const picker = container.querySelector('.portal-access-role-user-picker input[type="text"]') as HTMLInputElement;
    dispatchInput(picker, "history");
    await settle(300);
    // The suggestion list is located by the name it announces rather than by
    // the container class it happens to carry, so it keeps working through the
    // next restyling the way a reader's route into it does.
    const suggestions = container.querySelector('[role="group"][aria-label="Matching users"]')!;
    void act(() => (suggestions.querySelector("button") as HTMLButtonElement).click());
    await settle();

    const initial = requests.find((url) => url.pathname === `/api/v1/users/${USER_ID}/roles`);
    expect(initial?.searchParams.get("limit")).toBe("25");
    expect(initial?.searchParams.get("offset")).toBe("0");
    expect(initial?.searchParams.get("sort")).toBe("-created_at");
    expect(container.querySelector(".pk-pager__summary")?.textContent).toBe("1–1 of 26");

    void act(() => (container.querySelector('button[aria-label="Next page"]') as HTMLButtonElement).click());
    await settle();
    const roleRequests = requests.filter((url) => url.pathname === `/api/v1/users/${USER_ID}/roles`);
    expect(roleRequests.at(-1)?.searchParams.get("offset")).toBe("25");

    const search = container.querySelector('input[placeholder="Search role assignments…"]') as HTMLInputElement;
    dispatchInput(search, "membership");
    void act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(roleRequests.length).toBeLessThan(
      requests.filter((url) => url.pathname === `/api/v1/users/${USER_ID}/roles`).length,
    );
    const searched = requests.filter((url) => url.pathname === `/api/v1/users/${USER_ID}/roles`).at(-1);
    expect(searched?.searchParams.get("q")).toBe("membership");
    expect(searched?.searchParams.get("offset")).toBe("0");
  });

  it("loads secondary emails through the page envelope and exposes search and final-page navigation", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        if (url.pathname !== `/api/v1/users/${USER_ID}/emails`) throw new Error(`Unexpected request: ${url}`);
        return jsonResponse({
          emails: [
            {
              id: EMAIL_ID,
              userId: USER_ID,
              email: "alias@example.test",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          page: page(url, 11, 1),
        });
      }),
    );

    const container = mount(<UserEmailAddressesPanel userId={USER_ID} primaryEmail="primary@example.test" canWrite />);
    await settle();
    expect(requests[0].searchParams.get("limit")).toBe("10");
    expect(requests[0].searchParams.get("offset")).toBe("0");
    expect(requests[0].searchParams.get("sort")).toBe("email");
    expect(container.querySelector(".pk-pager__summary")?.textContent).toBe("1–1 of 11");

    void act(() => (container.querySelector('button[aria-label="Next page"]') as HTMLButtonElement).click());
    await settle();
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("10");

    const search = container.querySelector('input[placeholder="Search secondary emails…"]') as HTMLInputElement;
    dispatchInput(search, "alias");
    void act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(requests.at(-1)?.searchParams.get("q")).toBe("alias");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
  });

  it("only removes a secondary email through the confirm dialog when the removal is confirmed", async () => {
    const requests: Array<{ method: string; pathname: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        requests.push({ method: init?.method ?? "GET", pathname: url.pathname });
        if (url.pathname === `/api/v1/users/${USER_ID}/emails/${EMAIL_ID}`) return jsonResponse({ success: true });
        if (url.pathname !== `/api/v1/users/${USER_ID}/emails`) throw new Error(`Unexpected request: ${url}`);
        return jsonResponse({
          emails: [
            {
              id: EMAIL_ID,
              userId: USER_ID,
              email: "alias@example.test",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          page: page(url, 1, 1),
        });
      }),
    );

    const container = mount(
      <>
        <ConfirmDialogHost />
        <UserEmailAddressesPanel userId={USER_ID} primaryEmail="primary@example.test" canWrite />
      </>,
    );
    await settle();

    function dialogButton(label: string): HTMLButtonElement {
      const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
      if (!button) throw new Error(`missing button: ${label}`);
      return button;
    }

    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
    void act(() => trigger.click());
    void act(() => dialogButton("Remove email").click());
    expect(container.textContent).toContain("Remove alias@example.test from this account?");
    void act(() => dialogButton("Cancel").click());
    await settle();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);

    void act(() => trigger.click());
    void act(() => dialogButton("Remove email").click());
    void act(() => dialogButton("Remove email").click());
    await settle();
    const deleteRequest = requests.find((r) => r.method === "DELETE");
    expect(deleteRequest?.pathname).toBe(`/api/v1/users/${USER_ID}/emails/${EMAIL_ID}`);
  });
});
