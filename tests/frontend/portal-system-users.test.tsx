// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserProfileEditor } from "../../assets/ts/member-flows/portal/sections/system-users/UserProfileEditor";
import {
  UserDetail as UserDetailView,
  type UserPermissions,
} from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
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
    expect(userUpdateSchema.parse(lastCall?.[1])).toMatchObject({ preferredName: "Ada", firstName: "Ada" });
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
    expect(choiceNamed(container, "Active").checked).toBe(true);
    expect(choiceNamed(container, "Executive Council member").checked).toBe(false);
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
      formerIdentities: [],
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

    // The record's destructive command lives in its actions menu now, so the
    // menu is opened first. The confirmation contract below is unchanged.
    await act(() => dialogButton("⋯").click());
    await act(() => dialogButton("Anonymize user…").click());
    // Selecting from a menu adds an async hop before the dialog mounts, which
    // a direct button click did not have.
    await act(async () => {
      await Promise.resolve();
    });
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
    // Re-opening goes back through the menu, as it did the first time.
    await act(() => dialogButton("⋯").click());
    await act(() => dialogButton("Anonymize user…").click());
    await act(async () => {
      await Promise.resolve();
    });
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

/**
 * The record itself, after the surface moved off Bootstrap.
 *
 * What is worth asserting here is not that the markup changed but that the
 * things a visual review cannot see are right: the record has a heading, each
 * field is paired with its value, a failed load says so out loud, and the
 * anonymized state is carried by words rather than by a red date.
 */
describe("portal System Users detail record", () => {
  const READ_ONLY: UserPermissions = {
    canRead: true,
    canWrite: false,
    canGrantAccess: false,
    canAnonymize: false,
    canManageMembership: false,
    canActivateIdentity: false,
  };

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function stubDetail(record: UserDetail): void {
    apiClient.getJson.mockReset();
    apiClient.getJson.mockImplementation(async (url: string) => {
      if (url === `/api/v1/users/${record.id}`) return { user: record };
      if (url.startsWith(`/api/v1/users/${record.id}/emails`)) {
        return { emails: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } };
      }
      throw new Error(`Unexpected getJson call: ${url}`);
    });
  }

  async function mountDetail(permissions: UserPermissions, viewerUserId?: string): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() =>
      render(<UserDetailView userId={user.id} permissions={permissions} viewerUserId={viewerUserId} />, container),
    );
    await settle();
    return container;
  }

  /** A card by the name it carries as a region, not by where it sits. */
  function cardNamed(container: HTMLElement, name: string): Element | null {
    return container.querySelector(`.pk-panel[aria-label="${name}"]`);
  }

  function terms(list: Element): string[] {
    return [...list.querySelectorAll(":scope > dt")].map((term) => term.textContent ?? "");
  }

  it("heads the record with a real heading and pairs every field with its value", async () => {
    stubDetail(user);
    const container = await mountDetail(READ_ONLY);

    // The name used to be a `<span>` with a legacy class, so the page had no
    // entry in the document outline at all.
    expect(container.querySelector("h2")?.textContent).toBe("Ada Lovelace");

    // One record's fields are a term/value list, not an unnamed `<table>`
    // announced alongside the other tables further down the page.
    //
    // Scoped to the Account panel rather than taking the first list on the
    // page: the record is now laid out as main column plus aside, and several
    // panels carry their own description list. Targeting by position would
    // pass or fail on panel order rather than on the pairing this asserts.
    const panelTitled = (title: string) =>
      [...container.querySelectorAll(".pk-panel")].find(
        (panel) => panel.querySelector(".pk-panel__title")?.textContent === title,
      );

    const accountPanel = panelTitled("Account");
    expect(accountPanel, "the record has an Account panel").toBeTruthy();
    const list = accountPanel!.querySelector("dl.pk-datalist");
    expect(list).not.toBeNull();
    // The address is not here: it answers "how do I reach this person", which
    // is the Contact panel's question, and a fact stated in two panels on one
    // page is a fact the reader has to check for agreement.
    expect(terms(list!)).toEqual(["First name", "Last name", "Preferred name", "Role", "Active", "Created"]);
    expect(list!.querySelectorAll(":scope > dd")).toHaveLength(6);
    // An absent value is still a value, so the pairing never goes out of step.
    expect([...list!.querySelectorAll(":scope > dd")][2]?.textContent).toBe("—");

    // Stated once, and paired with a term rather than loose in the panel.
    const contactPanel = panelTitled("Contact");
    expect(contactPanel, "the record has a Contact panel").toBeTruthy();
    const contactList = contactPanel!.querySelector("dl.pk-datalist");
    expect(terms(contactList!)).toEqual(["Email"]);
    expect(contactList!.textContent).toContain("member@example.test");
  });

  it("keeps the visibility settings from a reader who cannot change them", async () => {
    stubDetail({
      ...user,
      identities: [
        {
          identityId: "identity-1",
          memberId: "member-1",
          membershipCategory: "A",
          status: "active",
          showOnOrgProfile: true,
          organizationId: "organization-1",
          organizationName: "Organization A",
          emailId: null,
          email: "ada@organization-a.example",
          jobTitle: "Standards lead",
          biography: null,
          links: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          groups: [],
        },
      ],
    });

    // Visibility states no fact about the person — only how the record is
    // configured. To a reader who cannot change it, it is a list of switches
    // they are not holding, and it advertises which parts are withheld.
    const reader = await mountDetail(READ_ONLY);
    expect(cardNamed(reader, "Visibility")).toBeNull();

    const writer = await mountDetail({ ...READ_ONLY, canWrite: true });
    expect(cardNamed(writer, "Visibility")).not.toBeNull();
    expect(cardNamed(writer, "Visibility")?.textContent).toContain("Organization A");
  });

  it("offers nothing on your own record that only makes sense aimed at someone else", async () => {
    stubDetail(user);

    const other = await mountDetail(READ_ONLY, "somebody-else");
    expect(other.querySelector('button[aria-label="Message — not available yet"]')).not.toBeNull();
    expect(other.querySelector('button[aria-label="Follow — not available yet"]')).not.toBeNull();

    // Nobody messages or follows themselves. The actions menu stays, because
    // the record is still one the reader may act on.
    const own = await mountDetail(READ_ONLY, user.id);
    expect(own.querySelector('button[aria-label="Message — not available yet"]')).toBeNull();
    expect(own.querySelector('button[aria-label="Follow — not available yet"]')).toBeNull();
    expect(own.querySelector('button[aria-label="Record actions"]')).not.toBeNull();
  });

  it("returns to the list through the header's trail rather than a back button", async () => {
    stubDetail(user);
    const container = await mountDetail(READ_ONLY);

    const trail = container.querySelector('nav[aria-label="Breadcrumb"]');
    expect(trail).not.toBeNull();
    const backLink = trail!.querySelector<HTMLAnchorElement>("a");
    expect(backLink?.textContent).toBe("Users");
    expect(backLink?.getAttribute("href")).toBe("#/users");
  });

  it("reports a failed load as an alert instead of an empty record", async () => {
    apiClient.getJson.mockReset();
    apiClient.getJson.mockRejectedValue(new Error("HTTP 503"));

    const container = await mountDetail(READ_ONLY);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("The service is temporarily unavailable.");
    expect(container.querySelector("dl.pk-datalist")).toBeNull();
  });

  it("refuses the record without read permission, and does not ask the server for it", async () => {
    apiClient.getJson.mockReset();

    const container = await mountDetail({ ...READ_ONLY, canRead: false });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "You need Users read permission to open a user record.",
    );
    expect(apiClient.getJson).not.toHaveBeenCalled();
  });

  it("says an account is anonymized in words, not only in a colour, and withdraws its controls", async () => {
    const redacted: UserDetail = { ...user, pii_redacted_at: "2026-02-02T10:00:00.000Z" };
    stubDetail(redacted);

    const container = await mountDetail({
      ...READ_ONLY,
      canWrite: true,
      canAnonymize: true,
    });

    const notice = [...container.querySelectorAll('[role="alert"]')].find((node) =>
      node.textContent?.includes("This account has been anonymized"),
    );
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain("cannot be restored");

    // Editing and anonymizing are both off the table once the record is
    // redacted, so neither control is offered.
    const buttonText = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttonText).not.toContain("Anonymize user");
    expect(buttonText).not.toContain("Edit profile");
  });
});
