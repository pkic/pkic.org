// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventTeamRoleCreateResponseSchema,
  eventTeamRolesResponseSchema,
} from "../../assets/shared/schemas/event-team";
import { Team } from "../../assets/ts/admin/sections/events/detail/Team";

const ROLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const GRANTER_ID = "10000000-0000-4000-8000-000000000003";
const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function rolesResponse() {
  return eventTeamRolesResponseSchema.parse({
    roles: [
      {
        id: ROLE_ID,
        userEmail: "moderator@example.test",
        userId: USER_ID,
        role: "moderator",
        grantedByUserId: GRANTER_ID,
        expiresAt: null,
        createdAt: "2026-08-29T10:00:00.000Z",
        granterEmail: "organizer@example.test",
      },
    ],
    page: { limit: 100, offset: 0, total: 1, hasMore: false },
  });
}

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<Team slug="architecture-workshop" />, container));
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

describe("event team role management", () => {
  it("lists, assigns, and revokes roles through the canonical event resource", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ path: url.pathname, method, body });
        if (method === "POST") {
          return json(
            eventTeamRoleCreateResponseSchema.parse({
              role: {
                ...rolesResponse().roles[0],
                id: "10000000-0000-4000-8000-000000000004",
                userEmail: "organizer@example.test",
                role: "organizer",
              },
            }),
            201,
          );
        }
        if (method === "DELETE") return json({ success: true });
        return json(rolesResponse());
      }),
    );

    const container = mount();
    await settle();
    await settle();

    expect(requests[0]).toMatchObject({ path: "/api/v1/events/architecture-workshop/roles", method: "GET" });
    expect(container.textContent).toContain("moderator@example.test");
    expect(container.textContent).toContain("Moderator");
    expect(requests.some(({ path }) => path.includes("/api/v1/admin/"))).toBe(false);

    const revoke = [...container.querySelectorAll("button")].find((button) => button.textContent === "Revoke");
    expect(revoke).toBeDefined();
    await act(async () => revoke!.click());
    await settle();

    expect(requests.find(({ method }) => method === "DELETE")).toEqual({
      path: `/api/v1/events/architecture-workshop/roles/${ROLE_ID}`,
      method: "DELETE",
      body: undefined,
    });

    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    const role = container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      email.value = "organizer@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      role.value = "organizer";
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests.find(({ method }) => method === "POST")).toEqual({
      path: "/api/v1/events/architecture-workshop/roles",
      method: "POST",
      body: { userEmail: "organizer@example.test", role: "organizer" },
    });
  });
});
