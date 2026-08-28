// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsersList } from "../../assets/ts/member-flows/portal/sections/system-users/UsersList";

const mounted: HTMLElement[] = [];

function mount(canGrantAccess: boolean): HTMLElement {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            users: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                email: "member@example.test",
                first_name: "Ada",
                last_name: "Lovelace",
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
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<UsersList canWrite canGrantAccess={canGrantAccess} onViewUser={vi.fn()} />, container));
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

describe("portal System Users list permissions", () => {
  it("hides the role action for users:write without access:grant", async () => {
    const container = mount(false);
    await settle();
    expect(container.querySelector(".adm-user-role-select")).toBeNull();
  });

  it("shows the role action only when both permissions are present", async () => {
    const container = mount(true);
    await settle();
    expect(container.querySelector(".adm-user-role-select")).not.toBeNull();
  });
});
