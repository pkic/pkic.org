// @vitest-environment jsdom
/** The user record's profile, participation, actions and staff-only audit log. */
import { render } from "preact";
import { IDENTITY_ID, membership, userWith } from "./helpers/affiliation-fixtures";
import { act } from "preact/test-utils";
import { menuItemNamed } from "./helpers/row-actions";
import { afterEach, describe, expect, it, vi } from "vitest";
// The record routes the identity grant under itself, so it reads the hash
// location; the mock keeps the router out of the test.
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
import {
  UserDetail as UserDetailView,
  type UserPermissions,
} from "../../assets/ts/member-flows/portal/sections/system-users/UserDetail";
import type { UserDetail } from "../../assets/ts/member-flows/portal/sections/system-users/model";

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
  ...userWith([]),
  first_name: "Ada",
  last_name: "Lovelace",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  history.replaceState(null, "", "/portal/#/");
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
      if (url.startsWith(`/api/v1/users/${record.id}/audit-log`)) {
        return { auditLog: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } };
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

  function personalProfile(biography: string | null) {
    return membership({
      identityId: "00000000-0000-4000-8000-000000000099",
      organizationId: null,
      organizationName: null,
      memberId: null,
      membershipCategory: null,
      groups: [],
      biography,
    });
  }

  it.each(["owner", "staff", "reader"] as const)(
    "attributes a general introduction and its edit action for %s",
    async (viewer) => {
      const personal = personalProfile("General introduction across my roles.");
      const organization = membership({ biography: "Role-specific organization biography." });
      stubDetail({ ...user, identities: [personal, organization] });
      const container = await mountDetail(
        { ...READ_ONLY, canManageMembership: viewer === "staff" },
        viewer === "owner" ? user.id : undefined,
      );
      const about = cardNamed(container, "About")!;
      expect(about.textContent).toContain(personal.biography);
      expect(about.textContent).not.toContain(organization.biography);
      expect(container.textContent).toContain(organization.biography);
      const trigger = about.querySelector<HTMLButtonElement>('button[aria-label="About actions"]');
      if (viewer === "reader") {
        expect(trigger).toBeNull();
        return;
      }
      expect(trigger).not.toBeNull();
      void act(() => trigger!.click());
      expect(menuItemNamed(container, "Edit About you…")?.getAttribute("href")).toContain(personal.identityId);
    },
  );

  it("attributes the fallback organization bio and offers separate general and organization edits", async () => {
    const personal = personalProfile(null);
    const organization = membership({ biography: "Role-specific organization biography." });
    stubDetail({ ...user, identities: [personal, organization] });
    const container = await mountDetail({ ...READ_ONLY, canManageMembership: true });
    const about = cardNamed(container, "About")!;
    expect(about.textContent).toContain(organization.biography);
    expect(about.textContent).toContain(`From the ${organization.organizationName} profile.`);
    void act(() => about.querySelector<HTMLButtonElement>('button[aria-label="About actions"]')!.click());
    expect(menuItemNamed(container, "Add About you…")?.getAttribute("href")).toContain(personal.identityId);
    expect(menuItemNamed(container, `Edit bio at ${organization.organizationName}…`)?.getAttribute("href")).toContain(
      organization.identityId,
    );
  });

  it.each(["owner", "staff"] as const)("words an empty About for the %s reading it", async (viewer) => {
    stubDetail({ ...user, identities: [personalProfile(null)] });
    const container = await mountDetail(
      { ...READ_ONLY, canManageMembership: viewer === "staff" },
      viewer === "owner" ? user.id : undefined,
    );
    const about = cardNamed(container, "About")!.textContent ?? "";
    if (viewer === "owner") expect(about).toContain("Add a general introduction covering your interests and roles.");
    else {
      expect(about).toContain("has not added a general introduction yet.");
      expect(about).not.toContain("your interests");
    }
  });

  it("loads the audit log only when staff select its data view", async () => {
    history.replaceState(null, "", `/portal/#/users/${user.id}`);
    stubDetail(user);
    const staff = await mountDetail(READ_ONLY);
    const auditTab = staff.querySelector<HTMLButtonElement>('[role="tab"][id="participation-audit-log"]')!;
    expect(auditTab).not.toBeNull();
    expect(auditTab.getAttribute("aria-selected")).toBe("false");
    const auditRequests = () =>
      apiClient.getJson.mock.calls.filter(
        ([url]) => new URL(String(url), location.origin).pathname === `/api/v1/users/${user.id}/audit-log`,
      );
    expect(auditRequests()).toHaveLength(0);

    await act(() => auditTab.click());
    await settle();
    expect(location.hash).toBe(`#/users/${user.id}/audit-log`);
    const panel = staff.querySelector('[role="tabpanel"]')!;
    expect(auditTab.getAttribute("aria-selected")).toBe("true");
    expect(auditTab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(auditTab.id);
    expect(panel.querySelector("table")).not.toBeNull();
    expect(auditRequests()).toHaveLength(1);
  });

  it("does not expose or fetch the audit log on a member's own record, including a direct link", async () => {
    history.replaceState(null, "", `/portal/#/users/${user.id}/audit-log`);
    stubDetail(user);
    const self = await mountDetail({ ...READ_ONLY, canRead: false }, user.id);
    expect(self.querySelector('[role="tab"]')).toBeNull();
    expect(apiClient.getJson.mock.calls.some(([url]) => String(url).includes("/audit-log"))).toBe(false);
  });

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
    expect(terms(list!)).toEqual(["First name", "Last name", "Preferred name", "Active", "Created"]);
    expect(list!.querySelectorAll(":scope > dd")).toHaveLength(5);
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
          organizationEmailDomain: null,
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

  it("offers only actions that work, on your own record and on someone else's", async () => {
    stubDetail(user);

    // Messaging and following have no domain behind them, so the record does
    // not advertise them as disabled controls; the actions menu is the only
    // action either reader sees.
    for (const viewer of ["somebody-else", user.id]) {
      const root = await mountDetail(READ_ONLY, viewer);
      const labels = [...root.querySelectorAll("button")].map(
        (button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
      );
      expect(labels.filter((label) => /^(Message|Follow)\b/.test(label))).toEqual([]);
      expect(root.textContent).not.toContain("not available yet");
      expect(root.querySelector('button[aria-label="Record actions"]')).not.toBeNull();
    }
  });

  it("lets a reader vouch for somebody else's skills but never for their own", async () => {
    stubDetail(user);
    const withoutSkills = apiClient.getJson.getMockImplementation()!;
    apiClient.getJson.mockImplementation(async (url: string) =>
      url === `/api/v1/users/${user.id}/skills`
        ? {
            skills: [{ skillId: "skill-1", slug: "eidas", name: "eIDAS", vouchCount: 2, vouchedByViewer: false }],
            totalVouches: 2,
          }
        : withoutSkills(url),
    );

    // Somebody else's record: each skill is a toggle carrying its own state.
    const other = await mountDetail(READ_ONLY, "somebody-else");
    const skills = other.querySelector('[aria-label="Skills"]')!;
    expect(skills.querySelector('button[aria-pressed="false"]')?.textContent).toContain("eIDAS");
    expect(skills.textContent).toContain("only members who share a group can vouch");

    // The reader's own record states the rule instead of offering a control
    // that could only ever answer with a refusal.
    const own = await mountDetail(READ_ONLY, user.id);
    const ownSkills = own.querySelector('[aria-label="Skills"]')!;
    expect(ownSkills.textContent).toContain("eIDAS");
    expect(ownSkills.querySelector("button")).toBeNull();
    expect(ownSkills.textContent).toContain("Nobody vouches for their own skills.");
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

  it("edits the account fields in a dialog from the Account panel menu, never inline", async () => {
    /*
     * The panel always states the facts; a quick edit opens in a dialog from
     * the panel's "…" menu, and the record's own "Edit profile" opens the same one.
     */
    stubDetail(user);
    const container = await mountDetail({ ...READ_ONLY, canWrite: true });

    const account = container.querySelector<HTMLElement>('section[aria-label="Account"]')!;
    expect(account.querySelectorAll("input")).toHaveLength(0);
    expect(account.textContent).toContain("First name");
    expect(account.querySelector('button[aria-label="Edit profile"]')).toBeNull();

    const menu = account.querySelector<HTMLButtonElement>('button[aria-label="Account actions"]')!;
    void act(() => menu.click());
    expect([...account.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
      "Edit account…",
    ]);
    void act(() => menuItemNamed(container, "Edit account…")?.click());

    const dialog = account.querySelector<HTMLElement>("dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("form")).not.toBeNull();
    // The Dialog's confirm submits; the form carries no button row of its own.
    expect(dialog.querySelector("form button")).toBeNull();
    for (const label of ["First name", "Last name", "Preferred name"]) {
      const field = [...dialog.querySelectorAll("label")].find((node) => node.textContent?.trim() === label);
      expect(field, `${label} is edited in the dialog`).toBeDefined();
    }
  });

  it("opens the same dialog from the record's Edit profile command", async () => {
    stubDetail(user);
    const container = await mountDetail({ ...READ_ONLY, canWrite: true });
    const menu = container.querySelector<HTMLButtonElement>(".pk-menu__trigger");
    void act(() => menu!.click());
    void act(() => menuItemNamed(container, "Edit profile")?.click());
    expect(container.querySelector('section[aria-label="Account"] dialog form')).not.toBeNull();
  });

  it("opens the group a participation row names, rather than listing it inertly", async () => {
    /*
     * Issue #45: a row that presents another asset goes to that asset. An
     * `href` rather than a click handler, so the reader can open it in a new
     * tab the way they can open any other link on the page.
     */
    // A seat is shown under the identity it was taken as.
    stubDetail(
      { ...user, identities: [membership()] },
      {
        summary: { groups: 1, meetingsHeld: 2, meetingsAttended: 1, votesCast: 0, votesEligible: 0 },
        groups: [
          {
            group: {
              id: "20000000-0000-4000-8000-000000000003",
              slug: "pqc",
              name: "PQC Working Group",
              type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
            },
            identityId: IDENTITY_ID,
            title: null,
            joinedAt: "2026-02-01T00:00:00.000Z",
            leftAt: null,
            held: 2,
            attended: 1,
            lastAttendedAt: null,
          },
        ],
      },
    );
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

  it("says an account is anonymized in words, not only in a color, and withdraws its controls", async () => {
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
