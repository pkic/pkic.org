// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsersList } from "../../assets/ts/member-flows/portal/sections/system-users/UsersList";

const mounted: HTMLElement[] = [];

function mount(canGrantAccess: boolean, headshotUrl: string | null = null, onViewUser = vi.fn()): HTMLElement {
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
                headshotUrl,
                activeIdentityCount: 0,
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
  void act(() => render(<UsersList canWrite canGrantAccess={canGrantAccess} onViewUser={onViewUser} />, container));
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
  it("hides the role actions for users:write without access:grant", async () => {
    const container = mount(false);
    await settle();
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it("offers the administrator-role action only when both permissions are present", async () => {
    const container = mount(true);
    await settle();
    const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(trigger).not.toBeNull();
    trigger!.click();
    await settle();
    const items = [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["Grant administrator role"]);
  });

  it("renders initials when a user has no headshot, and an image when one is set", async () => {
    const container = mount(false, null);
    await settle();
    const avatar = container.querySelector(".portal-user-avatar");
    expect(avatar?.querySelector("img")).toBeNull();
    expect(avatar?.textContent).toBe("AL");

    const withPhoto = mount(false, "/api/v1/users/00000000-0000-4000-8000-000000000001/headshots/photo.webp");
    await settle();
    const photoAvatar = withPhoto.querySelector(".portal-user-avatar img");
    expect(photoAvatar).not.toBeNull();
    expect(photoAvatar?.getAttribute("src")).toBe(
      "/api/v1/users/00000000-0000-4000-8000-000000000001/headshots/photo.webp",
    );
  });

  it("navigates to the user detail page when a row is clicked", async () => {
    const onViewUser = vi.fn();
    const container = mount(true, null, onViewUser);
    await settle();
    const row = container.querySelector<HTMLTableRowElement>(".adm-user-row");
    expect(row).not.toBeNull();
    row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onViewUser).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });
});
