// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProfileEditor } from "../../assets/ts/member-flows/portal/sections/system-users/UserProfileEditor";
import { UserDetail as UserDetailView } from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import type { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/model";
import { typedConfirmationInput } from "./helpers/confirm-dialog";
import {
  buttonNamed,
  controlFor,
  groupNames,
  labelNames,
  namedGroup,
  submitForm,
  typeInto,
} from "./helpers/labelled-control";
import { userUpdateSchema } from "../../assets/shared/schemas/user-management";

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
  role: "user",
  active: true,
  isEcMember: false,
  headshotUrl: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  pii_redacted_at: null,
  identities: [],
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
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(3);
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.querySelector('input[name="edit-role"]')).toBeNull();
  });

  it("exposes email and role controls only with access:grant", () => {
    const container = mount(true);
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="edit-role"]')).not.toBeNull();
  });

  it("stores preferred names on the user rather than an acting identity", async () => {
    apiClient.patchJson.mockResolvedValue({
      success: true,
      user: { id: user.id, email: user.email, role: user.role, active: true, isEcMember: false },
    });
    const linkedUser = { ...user, preferred_name: "Ada" };
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<UserProfileEditor user={linkedUser} canGrantAccess={false} onSaved={vi.fn()} />, container));
    void act(() => buttonNamed(container, "Edit profile").click());
    // Resolved through the label's `for`/`id` pair rather than a hand-written
    // id, so the lookup fails exactly when that pairing is broken.
    expect(controlFor(container, "Preferred name").value).toBe("Ada");
    await submitForm(container);
    expect(apiClient.patchJson).toHaveBeenCalledWith(
      `/api/v1/users/${user.id}`,
      expect.objectContaining({ preferredName: "Ada" }),
      expect.anything(),
    );
    // The body is what the canonical update contract accepts, not merely what
    // this form happens to send.
    const lastCall = apiClient.patchJson.mock.calls.at(-1);
    expect(userUpdateSchema.safeParse(lastCall?.[1]).success).toBe(true);
  });

  it("names every control it draws and groups the ones that belong together", () => {
    const container = mount(true);
    expect(labelNames(container)).toEqual(
      expect.arrayContaining(["First name", "Last name", "Preferred name", "Email", "admin", "user", "guest"]),
    );
    expect(groupNames(container)).toEqual(["Role", "Standing"]);
    // A checkbox needs all three parts, or it renders an operating-system
    // default control that no stylesheet reaches.
    const standing = namedGroup(container, "Standing");
    for (const label of standing.querySelectorAll("label.pk-check")) {
      expect(label.querySelector("input.pk-check__input")).not.toBeNull();
      expect(label.querySelector("span.pk-check__label")).not.toBeNull();
    }
    expect(controlFor(container, "Active").checked).toBe(true);
    expect(controlFor(container, "Executive Council member").checked).toBe(false);
  });

  it("marks a malformed address invalid, blocks the save, and clears once it is fixed", async () => {
    apiClient.patchJson.mockClear();
    const container = mount(true);
    const email = controlFor(container, "Email");
    await typeInto(email, "not-an-address");

    expect(email.getAttribute("aria-invalid")).toBe("true");
    const messageId = email.getAttribute("aria-describedby");
    expect(messageId).toBeTruthy();
    const message = container.querySelector(`[id="${messageId}"]`)!;
    // Announced, and readable without being able to tell red from gray.
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.textContent).toContain("Enter a valid email address.");
    expect(buttonNamed(container, "Save").disabled).toBe(true);

    await submitForm(container);
    expect(apiClient.patchJson).not.toHaveBeenCalled();

    await typeInto(email, "ada@example.test");
    expect(email.getAttribute("aria-invalid")).toBeNull();
    expect(buttonNamed(container, "Save").disabled).toBe(false);
  });

  it("reports a rejected save as an alert instead of leaving the form looking saved", async () => {
    apiClient.patchJson.mockRejectedValueOnce(new Error("Email already in use"));
    const container = mount(true);
    await submitForm(container);

    const alert = [...container.querySelectorAll('[role="alert"]')].find((node) =>
      node.textContent?.includes("Email already in use"),
    );
    expect(alert).toBeTruthy();
    // Still editing, so the rejected values are not silently discarded.
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("does not expose acting-identity profile fields in the user-wide profile editor", async () => {
    const representedUser: UserDetail = {
      ...user,
      identities: [
        {
          identityId: "identity-1",
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
    expect(container.textContent).not.toContain("Canonical Organization");
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
      role: "user",
      active: true,
      isEcMember: false,
      headshotUrl: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      pii_redacted_at: null,
      identities: [],
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
              canActivateIdentity: false,
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
    const typed = typedConfirmationInput(container)!;
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
    const retyped = typedConfirmationInput(container)!;
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
