// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProfileEditor } from "../../assets/ts/member-flows/portal/sections/system-users/UserProfileEditor";

import type { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/model";
import { controlFor, groupNames, labelNames, namedGroup, submitForm, typeInto } from "./helpers/labelled-control";
import { USER_ROLE_LABELS, USER_ROLES, userUpdateSchema } from "../../assets/shared/schemas/user-management";
// Resolved through the mock below, which keeps the real class.
import { ApiClientError } from "../../assets/ts/shared/api-client";

const apiClient = vi.hoisted(() => ({
  patchJson: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
  deleteJson: vi.fn(),
  requestJson: vi.fn(),
}));
vi.mock("../../assets/ts/shared/api-client", async (importOriginal) => ({
  // The error class stays real, so a refusal is read the way the form reads it.
  ...(await importOriginal<typeof import("../../assets/ts/shared/api-client")>()),
  ...apiClient,
}));

/**
 * The choice control whose wrapping label reads `label`. A Checkbox or Radio
 * wraps its control in the label, so there is no `for` to follow.
 */
function choiceNamed(root: ParentNode, label: string): HTMLInputElement {
  const match = [...root.querySelectorAll<HTMLLabelElement>("label.pk-check")].find(
    (candidate) => candidate.querySelector(".pk-check__label")?.textContent === label,
  );
  const control = match?.querySelector<HTMLInputElement>("input");
  if (!control) throw new Error(`no choice control reads "${label}"`);
  return control;
}

function fieldOf(control: HTMLElement): HTMLElement {
  const field = control.closest<HTMLElement>(".pk-field");
  if (!field) throw new Error("control is not inside a Field");
  return field;
}

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
  formerIdentities: [],
};

function mount(canGrantAccess: boolean): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  /*
   * The record decides whether this is open — editing is a command in its
   * "…" menu now, not a button in a band of its own (#46) — so the harness
   * mounts it open rather than clicking a button that no longer exists.
   */
  void act(() =>
    render(
      <UserProfileEditor user={user} canGrantAccess={canGrantAccess} editing onClose={vi.fn()} onSaved={vi.fn()} />,
      container,
    ),
  );
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
    expect(container.querySelector('input[name="role"]')).toBeNull();
  });

  it("exposes email and role controls only with access:grant", () => {
    const container = mount(true);
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('input[name="role"]')).not.toBeNull();
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
    void act(() =>
      render(
        <UserProfileEditor user={linkedUser} canGrantAccess={false} editing onClose={vi.fn()} onSaved={vi.fn()} />,
        container,
      ),
    );
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
    expect(userUpdateSchema.parse(lastCall?.[1])).toMatchObject({ preferredName: "Ada", firstName: "Ada" });
  });

  it("names every control it draws and groups the ones that belong together", () => {
    const container = mount(true);
    // The roles are named by their words rather than by their stored codes,
    // and the words come from the vocabulary itself — so a role added to the
    // contract is offered here without anybody editing the form.
    expect(labelNames(container)).toEqual(
      expect.arrayContaining([
        "First name",
        "Last name",
        "Preferred name",
        "Email",
        ...USER_ROLES.map((role) => USER_ROLE_LABELS[role]),
      ]),
    );
    expect(groupNames(container)).toEqual(["Role", "Standing"]);
    // A checkbox needs all three parts, or it renders an operating-system
    // default control that no stylesheet reaches.
    const standing = namedGroup(container, "Standing");
    for (const label of standing.querySelectorAll("label.pk-check")) {
      expect(label.querySelector("input.pk-check__input")).not.toBeNull();
      expect(label.querySelector("span.pk-check__label")).not.toBeNull();
    }
    expect(choiceNamed(container, "Active").checked).toBe(true);
    // Council membership is the Executive Council group's roster, not a
    // checkbox on the account (#104).
    expect(container.textContent).not.toContain("Executive Council member");
  });

  it("refuses a malformed address at the field, sends nothing, and clears once it is fixed", async () => {
    apiClient.patchJson.mockClear();
    const container = mount(true);
    const email = controlFor(container, "Email");
    await typeInto(email, "not-an-address");

    // Refused as typed by the update contract rather than by a second regular
    // expression written here: the field shows the invalid state with the
    // contract's own reason, announced rather than only coloured.
    expect(fieldOf(email).classList.contains("pk-field--invalid")).toBe(true);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    const message = container.querySelector(`[id="${email.getAttribute("aria-describedby")}"]`)!;
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.textContent).toMatch(/email/i);

    await submitForm(container);
    // Nothing was sent; the refused field holds focus.
    expect(apiClient.patchJson).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(email);

    await typeInto(email, "ada@example.test");
    expect(email.getAttribute("aria-invalid")).toBeNull();
    expect(fieldOf(email).classList.contains("pk-field--ok")).toBe(true);
  });

  it("marks the field a server refusal names, and keeps the form open", async () => {
    apiClient.patchJson.mockRejectedValueOnce(
      new ApiClientError(
        {
          error: {
            code: "VALIDATION",
            message: "Invalid request",
            details: { fieldErrors: { email: ["Email already in use"] } },
          },
        },
        400,
      ),
    );
    const container = mount(true);
    await submitForm(container);

    const email = controlFor(container, "Email");
    expect(fieldOf(email).classList.contains("pk-field--invalid")).toBe(true);
    expect(fieldOf(email).querySelector('[role="alert"]')?.textContent).toContain("Email already in use");
    expect(document.activeElement).toBe(email);
    // Still editing, so the refused draft is not silently discarded.
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("reports a rejected save as an alert instead of leaving the form looking saved", async () => {
    apiClient.patchJson.mockRejectedValueOnce(
      new ApiClientError({ error: { code: "CONFLICT", message: "Email already in use" } }, 409),
    );
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
          isDefault: false,
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
      render(
        <UserProfileEditor user={representedUser} canGrantAccess={false} editing onClose={vi.fn()} onSaved={vi.fn()} />,
        container,
      ),
    );
    void act(() => (container.querySelector("button") as HTMLButtonElement).click());

    expect(container.querySelector("#user-organizationName")).toBeNull();
    expect(container.querySelector("#user-jobTitle")).toBeNull();
    expect(container.querySelector("#user-biography")).toBeNull();
    expect(container.textContent).not.toContain("Canonical Organization");
  });
});
