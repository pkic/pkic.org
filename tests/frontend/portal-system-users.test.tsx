// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProfileEditor } from "../../assets/ts/member-flows/portal/sections/system-users/UserProfileEditor";
import { UserDetail as UserDetailView } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import type { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/model";

const apiClient = vi.hoisted(() => ({
  patchJson: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
  deleteJson: vi.fn(),
  requestJson: vi.fn(),
}));
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

  it("does not expose stale user-wide organization profile fields for an organization representative", async () => {
    const representedUser: UserDetail = {
      ...user,
      organization_name: "Stale organization",
      job_title: "Stale title",
      biography: "Stale biography",
      links: ["https://stale.example.test/profile"],
      memberships: [
        {
          memberId: "representative-1",
          membershipCategory: "A",
          status: "active",
          showOnOrgProfile: true,
          organizationId: "organization-1",
          organizationName: "Canonical Organization",
          emailId: null,
          email: "role@canonical.example",
          jobTitle: "Canonical role",
          biography: "Canonical biography",
          links: ["https://canonical.example/profile"],
          createdAt: "2026-01-01T00:00:00.000Z",
          groups: [],
        },
      ],
    };
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() =>
      render(<UserProfileEditor user={representedUser} canGrantAccess={false} onSaved={vi.fn()} />, container),
    );
    void act(() => (container.querySelector("button") as HTMLButtonElement).click());

    expect(container.querySelector("#user-organizationName")).toBeNull();
    expect(container.querySelector("#user-jobTitle")).toBeNull();
    expect(container.querySelector("#user-biography")).toBeNull();
    expect(container.textContent).not.toContain("Stale organization");
  });
});

describe("portal System Users anonymize confirmation", () => {
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("requires the typed email confirmation and only anonymizes once confirmed", async () => {
    const userId = "00000000-0000-4000-8000-000000000099";
    const email = "dana@example.test";
    const detailUser = {
      id: userId,
      email,
      first_name: "Dana",
      last_name: "Yu",
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

    apiClient.getJson.mockReset();
    apiClient.postJson.mockReset();
    apiClient.getJson.mockImplementation(async (url: string) => {
      if (url === `/api/v1/users/${userId}`) return { user: detailUser };
      if (url === `/api/v1/users/${userId}/emails`) {
        return { emails: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } };
      }
      throw new Error(`Unexpected getJson call: ${url}`);
    });
    apiClient.postJson.mockImplementation(async (url: string) => {
      if (url === `/api/v1/users/${userId}/anonymize`) return { success: true, userId };
      throw new Error(`Unexpected postJson call: ${url}`);
    });

    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <UserDetailView
            userId={userId}
            onBack={() => {}}
            permissions={{
              canRead: true,
              canWrite: true,
              canGrantAccess: false,
              canAnonymize: true,
              canManageMembership: false,
            }}
          />
        </>,
        container,
      ),
    );
    await settle();

    function dialogButton(label: string): HTMLButtonElement {
      const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
      if (!button) throw new Error(`missing button: ${label}`);
      return button;
    }

    await act(() => dialogButton("Anonymize user").click());
    expect(container.textContent).toContain(`Anonymize ${email}?`);

    const confirmButton = dialogButton("Anonymize user");
    expect(confirmButton.disabled).toBe(true);
    const typed = container.querySelector<HTMLInputElement>("#pkic-confirm-typed")!;
    await act(() => {
      typed.value = "not-the-email";
      typed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dialogButton("Anonymize user").disabled).toBe(true);

    // Cancel: no anonymize request is sent.
    await act(() => dialogButton("Cancel").click());
    await settle();
    expect(apiClient.postJson).not.toHaveBeenCalled();

    // Confirm with the exact typed email: the anonymize request is sent.
    await act(() => dialogButton("Anonymize user").click());
    const retyped = container.querySelector<HTMLInputElement>("#pkic-confirm-typed")!;
    await act(() => {
      retyped.value = email;
      retyped.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => dialogButton("Anonymize user").click());
    await settle();

    expect(apiClient.postJson).toHaveBeenCalledWith(`/api/v1/users/${userId}/anonymize`, {}, expect.anything());

    document.body.removeChild(container);
  });
});
