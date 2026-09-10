// @vitest-environment jsdom
/**
 * The user record page: what it shows, what it offers, and to whom.
 *
 * Split out of portal-system-users.test.tsx, which had grown to cover both
 * the record and the profile form inside it. They are two subjects, and the
 * file was over its line budget carrying both.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { menuItemNamed } from "./helpers/row-actions";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UserDetail as UserDetailView,
  type UserPermissions,
} from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import type { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/model";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { typedConfirmationInput } from "./helpers/confirm-dialog";

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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

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

  function stubDetail(record: UserDetail, participation?: unknown): void {
    apiClient.getJson.mockReset();
    apiClient.getJson.mockImplementation(async (url: string) => {
      if (url === `/api/v1/users/${record.id}`) return { user: record };
      if (url.startsWith(`/api/v1/users/${record.id}/emails`)) {
        return { emails: [], page: { limit: 10, offset: 0, total: 0, hasMore: false } };
      }
      if (url === `/api/v1/users/${record.id}/participation`) {
        if (!participation) throw new Error("no participation stubbed");
        return { participation };
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
          isDefault: false,
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

  it("offers editing in the record's own actions menu, not as a band across the page", async () => {
    /*
     * Issue #46: "Edit profile" was a section of the record whose entire
     * content was one button. The record already carries a "…" menu of the
     * commands that apply to it — copying its link, anonymizing it — and
     * editing is one of those, so it is offered there and the band is gone.
     */
    stubDetail(user);
    const writer = await mountDetail({ ...READ_ONLY, canWrite: true });

    const menu = writer.querySelector<HTMLButtonElement>(".pk-menu__trigger");
    expect(menu).not.toBeNull();
    void act(() => menu!.click());
    const items = [...writer.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toContain("Edit profile");

    // And a reader who may not write is not offered it at all.
    const reader = await mountDetail(READ_ONLY);
    const readerMenu = reader.querySelector<HTMLButtonElement>(".pk-menu__trigger");
    void act(() => readerMenu?.click());
    expect([...reader.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).not.toContain(
      "Edit profile",
    );
  });

  it("does not arrive in edit mode, even on your own record", async () => {
    /*
     * Issue #47: editing is an action somebody takes, never a state a page
     * starts in. Your own record is the tempting exception — it is yours, so
     * why not open it ready to type — and it is not one: arriving in edit
     * mode means every visit risks a change nobody meant to make.
     */
    stubDetail(user);
    const container = await mountDetail({ ...READ_ONLY, canWrite: true });

    // The profile fields are not open until the record's menu opens them.
    // Other panels have their own controls — an address to add, a skill to
    // endorse — and those are not this record's edit mode.
    expect(container.querySelector('input[name="firstName"]')).toBeNull();
    const saves = [...container.querySelectorAll("button")].map((button) => button.textContent);
    expect(saves).not.toContain("Save changes");
    expect(saves).not.toContain("Save profile");
    const menu = container.querySelector<HTMLButtonElement>(".pk-menu__trigger");
    void act(() => menu!.click());
    expect([...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toContain(
      "Edit profile",
    );
  });

  it("edits the account fields in the card that states them, not in a panel of its own", async () => {
    /*
     * #46: the fields are edited where they are shown.
     *
     * Taking "Edit profile" used to append a whole second panel further down
     * the record carrying the same fields the Account card beside it was
     * already stating — the reader saw one name twice, and the two could
     * disagree while the draft was open. The command turns that card's own
     * list into that card's own fields instead.
     */
    stubDetail(user);
    const container = await mountDetail({ ...READ_ONLY, canWrite: true });

    const headings = () => [...container.querySelectorAll("h2, h3")].map((heading) => heading.textContent);
    expect(headings()).not.toContain("Profile");
    expect(headings()).not.toContain("Edit profile");
    // Closed, the card states the facts rather than offering them as fields.
    const account = container.querySelector<HTMLElement>('section[aria-label="Account"]')!;
    expect(account.querySelectorAll("input")).toHaveLength(0);
    expect(account.textContent).toContain("First name");

    const menu = container.querySelector<HTMLButtonElement>(".pk-menu__trigger");
    void act(() => menu!.click());
    void act(() => menuItemNamed(container, "Edit profile")?.click());

    // No second panel appeared; the card it names is now the form.
    expect(headings()).not.toContain("Edit profile");
    expect(account.querySelectorAll("input").length).toBeGreaterThan(0);
    // And the name fields are in that card, not merely somewhere on the page.
    for (const label of ["First name", "Last name", "Preferred name"]) {
      const field = [...account.querySelectorAll("label")].find((node) => node.textContent?.trim() === label);
      expect(field, `${label} is edited in the Account card`).toBeDefined();
    }
  });

  it("opens the group a participation row names, rather than listing it inertly", async () => {
    /*
     * Issue #45: a row that presents another asset goes to that asset. An
     * `href` rather than a click handler, so the reader can open it in a new
     * tab the way they can open any other link on the page.
     */
    stubDetail(user, {
      summary: { groups: 1, meetingsHeld: 2, meetingsAttended: 1, votesCast: 0, votesEligible: 0 },
      groups: [
        {
          group: {
            id: "20000000-0000-4000-8000-000000000003",
            slug: "pqc",
            name: "PQC Working Group",
            type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
          },
          title: null,
          held: 2,
          attended: 1,
        },
      ],
    });
    const container = await mountDetail(READ_ONLY);

    const link = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (anchor) => anchor.getAttribute("href") === "#/groups/20000000-0000-4000-8000-000000000003",
    );
    expect(link).toBeDefined();
    expect(link?.textContent).toContain("PQC Working Group");
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
