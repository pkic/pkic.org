// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProfileEditor } from "../../assets/ts/member-flows/portal/sections/system-users/UserProfileEditor";
import type { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/model";

const apiClient = vi.hoisted(() => ({ patchJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => apiClient);

const mounted: HTMLElement[] = [];

const user: UserDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "member@example.test",
  first_name: "Ada",
  last_name: "Lovelace",
  preferred_name: null,
  organization_name: null,
  job_title: null,
  biography: null,
  links: [],
  role: "user",
  active: true,
  isEcMember: false,
  headshotUrl: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  pii_redacted_at: null,
  memberships: [],
};

function mount(canGrantAccess: boolean): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() =>
    render(<UserProfileEditor user={user} canGrantAccess={canGrantAccess} onSaved={vi.fn()} />, container),
  );
  const edit = container.querySelector("button") as HTMLButtonElement;
  void act(() => edit.click());
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("portal System Users profile permissions", () => {
  it("lets users:write edit profile fields without exposing access-control fields", () => {
    const container = mount(false);
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(5);
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.querySelector('input[name="edit-role"]')).toBeNull();
  });

  it("exposes email and role controls only with access:grant", () => {
    const container = mount(true);
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="edit-role"]')).not.toBeNull();
  });

  it("shows existing profile links and preserves them in the profile command", async () => {
    apiClient.patchJson.mockResolvedValue({
      success: true,
      user: { id: user.id, email: user.email, role: user.role, active: true, isEcMember: false },
    });
    const linkedUser = { ...user, links: ["https://www.example.test/profile"] };
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<UserProfileEditor user={linkedUser} canGrantAccess={false} onSaved={vi.fn()} />, container));
    void act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(container.textContent).toContain("example.test");
    await act(async () => (container.querySelector(".btn-primary") as HTMLButtonElement).click());
    expect(apiClient.patchJson).toHaveBeenCalledWith(
      `/api/v1/users/${user.id}`,
      expect.objectContaining({ links: ["https://www.example.test/profile"] }),
      expect.anything(),
    );
  });
});
