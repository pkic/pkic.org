import {
  representationEmailChangeSchema,
  representationEmailOptionsResponseSchema,
} from "../../assets/shared/schemas/representation-email";
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleMembershipCategories } from "./helpers/membership-category-catalog";
vi.mock("../../assets/ts/hooks/useMembershipCategoryCatalog", () => ({
  useMembershipCategoryCatalog: () => exampleMembershipCategories,
}));
/**
 * The affiliations panel: the collection, and what may be added to it.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
// The panel's own command navigates to the grant page (#107); the mock keeps
// the router out of the test and records where it was sent.
const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));
import { UserAffiliationsPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationsPanel";
import {
  actingIdentitySchema,
  identitiesListResponseSchema,
  identityCreateSchema,
} from "../../assets/shared/schemas/identity";
import { organizationIdentityCreateRequestSchema } from "../../assets/shared/schemas/route-contracts-identities";
import { normalizeValidation } from "../../assets/ts/shared/form/validation-map";
import { buttonNamed, chooseComboboxOption, controlFor, typeInto } from "./helpers/labeled-control";
import {
  membership,
  MEMBER_ID,
  PICKED_ORGANIZATION_ID,
  USER_ID,
  describedByText,
  errorResponse,
  fieldOf,
  fieldRefusal,
  identityMutation,
  jsonResponse,
  mount,
  press,
  settle,
  stubFetch,
  toastArea,
  userWith,
  runRowMenuAction,
  organizationDetail,
  organizationList,
} from "./helpers/affiliation-fixtures";

describe("UserAffiliationsPanel", () => {
  beforeEach(() => {
    history.replaceState({}, "", "/");
    // jsdom has the element but not its modal behavior; mirror the platform's open state.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  });

  it("exposes the empty membership list as a live status region", () => {
    const container = mount();
    void act(() => render(<UserAffiliationsPanel user={userWith([])} onChanged={vi.fn()} canManage />, container));

    expect(container.querySelector('[role="status"]')?.textContent).toContain("No active identities.");
  });

  it.each([true, false])("keeps Add identity available for an individual member (self: %s)", (self) => {
    const container = mount();
    const individual = membership({ organizationId: null, organizationName: null, memberId: MEMBER_ID });
    void act(() =>
      render(
        <UserAffiliationsPanel
          user={userWith([individual])}
          onChanged={vi.fn()}
          canManage={!self}
          viewerIsSubject={self}
        />,
        container,
      ),
    );
    expect(container.querySelector('button[aria-label="Add identity"]')).not.toBeNull();
  });

  it("shows organization experience without an unused personal account profile", () => {
    const personal = membership({
      identityId: "00000000-0000-4000-8000-000000000099",
      organizationId: null,
      organizationName: null,
      memberId: null,
      membershipCategory: null,
      jobTitle: null,
      biography: "Retained account biography",
      isDefault: false,
      groups: [],
    });
    const container = mount();
    void act(() =>
      render(
        <UserAffiliationsPanel user={userWith([personal, membership()])} onChanged={vi.fn()} canManage />,
        container,
      ),
    );
    expect(container.textContent).not.toContain("Retained account biography");
    expect(container.textContent).not.toContain("Personal");
    expect(container.textContent).toContain("Organization A");
  });

  it.each(["sole", "member", "default", "acting"] as const)("preserves a meaningful personal identity: %s", (kind) => {
    const personal = membership({
      identityId: "00000000-0000-4000-8000-000000000099",
      organizationId: null,
      organizationName: null,
      memberId: kind === "member" ? MEMBER_ID : null,
      membershipCategory: kind === "member" ? "H6" : null,
      jobTitle: null,
      biography: "Personal profile content",
      groups: [],
      isDefault: kind === "default",
    });
    const container = mount();
    void act(() =>
      render(
        <UserAffiliationsPanel
          user={userWith(kind === "sole" ? [personal] : [personal, membership()])}
          onChanged={vi.fn()}
          canManage
          actingIdentityId={kind === "acting" ? personal.identityId : null}
        />,
        container,
      ),
    );
    expect(container.textContent).toContain("Personal profile content");
  });

  it("changes the address on the selected representation through the shared verified-email form", async () => {
    const selected = "00000000-0000-4000-8000-000000000088";
    const at = "2026-01-01T00:00:00.000Z";
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return jsonResponse({ success: true });
      return jsonResponse(
        representationEmailOptionsResponseSchema.parse({
          emailId: null,
          emails: [
            {
              id: selected,
              email: "person@organization-a.example",
              primary: false,
              identityId: null,
              verifiedAt: at,
              verificationMethod: "magic_link",
              signInEnabled: false,
              createdAt: at,
            },
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      );
    });
    vi.stubGlobal("fetch", transport);
    const changed = vi.fn();
    const container = mount();
    await act(async () =>
      render(
        <UserAffiliationsPanel user={userWith([membership()])} onChanged={changed} canManage={false} viewerIsSubject />,
        container,
      ),
    );
    runRowMenuAction(container, "Organization A", "Change representation email…");
    await settle();
    await chooseComboboxOption(container, "Representation email", selected);
    await press(container, "Save email");
    const write = transport.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(String(write[0])).toBe(`/api/v1/users/${USER_ID}/identities/${membership().identityId}/email`);
    expect(representationEmailChangeSchema.parse(JSON.parse(String(write[1]!.body)))).toMatchObject({
      previousEmailId: null,
      emailId: selected,
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("preselects the identity the person acts as when correcting another, and confirms the correction", async () => {
    const acting = "00000000-0000-4000-8000-000000000077";
    const at = "2026-01-01T00:00:00.000Z";
    const actingIdentity = actingIdentitySchema.parse({
      id: acting,
      userId: USER_ID,
      userName: "Person",
      memberId: null,
      organizationId: PICKED_ORGANIZATION_ID,
      organizationName: "Organization B",
      membershipCategory: null,
      emailId: null,
      email: "person@organization-b.example",
      jobTitle: null,
      biography: null,
      links: [],
      headshotUrl: null,
      source: "verified_email",
      state: "active",
      showOnOrganizationProfile: true,
      invitedAt: at,
      startedAt: at,
      endedAt: null,
      blockedAt: null,
      blockedByUserId: null,
      predecessorIdentityId: null,
      createdAt: at,
      updatedAt: at,
    });
    const requests = stubFetch((url) =>
      url.pathname.endsWith("/corrections")
        ? identityMutation("active")
        : jsonResponse(
            identitiesListResponseSchema.parse({
              identities: [actingIdentity],
              page: { limit: 25, offset: 0, total: 1, hasMore: false },
            }),
          ),
    );
    const area = toastArea();
    const changed = vi.fn();
    const container = mount();
    const wrong = membership();
    const other = membership({
      identityId: acting,
      organizationId: PICKED_ORGANIZATION_ID,
      organizationName: "Organization B",
    });
    await act(async () =>
      render(
        <UserAffiliationsPanel
          user={userWith([wrong, other])}
          onChanged={changed}
          canManage={false}
          viewerIsSubject
          actingIdentityId={acting}
        />,
        container,
      ),
    );
    runRowMenuAction(container, "Organization A", "Correct identity…");
    await settle();
    await settle();
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    await typeInto(controlFor<HTMLTextAreaElement>(dialog, "Reason for correction"), "Joined the wrong organization");
    await press(document.body, "Correct identity");
    const write = requests.find((request) => request.method === "POST")!;
    expect(write.pathname).toBe(`/api/v1/users/${USER_ID}/identities/${wrong.identityId}/corrections`);
    expect(write.body).toMatchObject({ replacementIdentityId: acting });
    expect(area.textContent).toContain("Identity corrected to Organization B");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  // The grant form is the body of the dialog the panel's header button opens.
  function openCreateForm(): HTMLElement {
    const container = mount();
    void act(() =>
      render(
        <UserAffiliationsPanel user={userWith([])} onChanged={async () => {}} canManage canActivateIdentity />,
        container,
      ),
    );
    void act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Add identity"]')!.click());
    return document.querySelector<HTMLDialogElement>("dialog[open]")!;
  }

  it("opens the identity form in a dialog from the header button, and Cancel closes it", async () => {
    const container = mount();
    void act(() =>
      render(<UserAffiliationsPanel user={userWith([])} onChanged={async () => {}} canManage />, container),
    );
    expect(container.querySelector("form")).toBeNull();
    const add = container.querySelector<HTMLButtonElement>('button[aria-label="Add identity"]');
    if (!add) throw new Error('the panel offers no "Add identity" button');
    expect(add.title).toBe("Add identity");
    void act(() => add.click());
    const dialog = document.querySelector("dialog");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog?.textContent).toContain("Add identity");
    expect(dialog?.querySelector('section[aria-label="Add identity"] form')).not.toBeNull();
    // The dialog owns the actions; the form carries no buttons of its own.
    expect(dialog?.querySelector("form button[type=submit]")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    void act(() => buttonNamed(document.body, "Cancel").click());
    await vi.waitFor(() => expect(dialog?.hasAttribute("open")).toBe(false));
  });

  // The organization is found by typing into one picker: no separate search
  // button, no second request for the record (#96).
  async function pickOrganizationOne(container: HTMLElement): Promise<HTMLInputElement> {
    await settle();
    await chooseComboboxOption(container, "Organization", PICKED_ORGANIZATION_ID);
    await settle();
    return controlFor<HTMLInputElement>(container, "Organization");
  }

  it("refuses an unpicked organization at the field, in the contract's words, and sends nothing", async () => {
    const requests = stubFetch(() => jsonResponse({ success: true }));
    const container = openCreateForm();

    await press(container, "Add identity");

    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);
    const organization = controlFor<HTMLInputElement>(container, "Organization");
    expect(fieldOf(organization).classList.contains("pk-field--invalid")).toBe(true);
    expect(organization.getAttribute("aria-invalid")).toBe("true");
    const message = document.querySelector(`[id="${organization.getAttribute("aria-describedby") ?? ""}"]`);
    expect(message?.getAttribute("role")).toBe("alert");
    // The field says what the create contract — path and body together —
    // says about an organization that is not there.
    const contract = organizationIdentityCreateRequestSchema.safeParse({
      organizationId: "",
      userReference: "existing_user",
      userId: USER_ID,
      showOnOrganizationProfile: true,
      activation: { mode: "invitation" },
    });
    expect(contract.success).toBe(false);
    expect(message?.textContent).toContain(normalizeValidation(contract.error).fields.organizationId);
    expect(document.activeElement).toBe(organization);
  });

  it.each([null, "A"])(
    "adds an identity without a membership operation (organization category: %s)",
    async (category) => {
      const requests = stubFetch((url) =>
        url.pathname === "/api/v1/organizations"
          ? jsonResponse({
              ...organizationList,
              organizations: organizationList.organizations.map((organization) => ({
                ...organization,
                membershipCategory: category,
              })),
            })
          : jsonResponse({ success: true, identityId: "00000000-0000-4000-8000-000000000099", state: "pending" }),
      );
      const container = openCreateForm();
      await pickOrganizationOne(container);
      expect(container.querySelector('select[name="membershipCategory"]')).toBeNull();
      expect([...container.querySelectorAll("label")].some((label) => label.textContent === "Category")).toBe(false);
      await typeInto(controlFor(container, "Job title"), "Standards lead");
      await press(container, "Add identity");
      const writes = requests.filter((request) => request.method === "POST");
      expect(writes).toHaveLength(1);
      expect(writes[0]!.pathname).toBe(`/api/v1/organizations/${PICKED_ORGANIZATION_ID}/identities`);
      expect(identityCreateSchema.parse(writes[0]!.body)).toMatchObject({
        userReference: "existing_user",
        userId: USER_ID,
        jobTitle: "Standards lead",
        activation: { mode: "invitation" },
      });
      expect(requests.some((request) => request.pathname.startsWith("/api/v1/members"))).toBe(false);
    },
  );

  it("marks the field a server refusal names, and keeps the form open", async () => {
    stubFetch((url) => {
      if (url.pathname === "/api/v1/organizations") return jsonResponse(organizationList);
      if (url.pathname === `/api/v1/organizations/${PICKED_ORGANIZATION_ID}`) return jsonResponse(organizationDetail);
      return fieldRefusal({ organizationId: ["That organization cannot take identities."] });
    });
    const container = openCreateForm();

    const organization = await pickOrganizationOne(container);
    await typeInto(controlFor(container, "Job title"), "Standards lead");
    await press(container, "Add identity");

    expect(fieldOf(organization).classList.contains("pk-field--invalid")).toBe(true);
    expect(fieldOf(organization).querySelector('[role="alert"]')?.textContent).toContain(
      "That organization cannot take identities.",
    );
    expect(document.activeElement).toBe(organization);
    expect(buttonNamed(container, "Add identity")).toBeDefined();
  });

  it("requires a documented reason before activating an identity immediately", async () => {
    const requests = stubFetch((url) =>
      url.pathname === "/api/v1/organizations" ? jsonResponse(organizationList) : jsonResponse(organizationDetail),
    );
    const container = openCreateForm();

    await pickOrganizationOne(container);
    expect(controlFor(container, "Organization").value).toBe("Organization One");
    // An organization identity is never granted without a job title.
    const jobTitle = controlFor(container, "Job title");
    expect(jobTitle.required).toBe(true);
    await typeInto(jobTitle, "Standards lead");

    const activate = container.querySelector<HTMLInputElement>("input#identity-activate-immediately");
    await act(() => {
      activate!.checked = true;
      activate!.dispatchEvent(new Event("input", { bubbles: true }));
      activate!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Whitespace clears the browser's own `required` check, so the surface's
    // trim is the only thing standing between this and an undocumented
    // immediate activation.
    expect(container.textContent).toContain("even if their email domain differs");
    const reason = controlFor(container, "Activation reason");
    expect(reason.getAttribute("required")).not.toBeNull();
    await typeInto(reason, "   ");
    await press(container, "Add identity");

    expect(fieldOf(reason).classList.contains("pk-field--invalid")).toBe(true);
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(reason)).toContain("Document why this identity is being activated immediately.");
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);

    await typeInto(reason, "Board approved on 2026-08-30");
    await press(container, "Add identity");

    const post = requests.find((request) => request.method === "POST");
    expect(post?.pathname).toBe(`/api/v1/organizations/${PICKED_ORGANIZATION_ID}/identities`);
    expect(identityCreateSchema.parse(post?.body)).toMatchObject({
      userReference: "existing_user",
      userId: USER_ID,
      jobTitle: "Standards lead",
      showOnOrganizationProfile: true,
      activation: { mode: "immediate", reason: "Board approved on 2026-08-30" },
    });
  });

  it("reports a rejected grant as a whole-form alert rather than blaming a control", async () => {
    const area = toastArea();
    stubFetch((url) => {
      if (url.pathname === "/api/v1/organizations") return jsonResponse(organizationList);
      if (url.pathname === `/api/v1/organizations/${PICKED_ORGANIZATION_ID}`) return jsonResponse(organizationDetail);
      return errorResponse("This user already holds an identity here", 409);
    });
    const container = openCreateForm();

    const organization = await pickOrganizationOne(container);
    await typeInto(controlFor(container, "Job title"), "Standards lead");
    await press(container, "Add identity");

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This user already holds an identity here",
    );
    expect(area.textContent).toContain("This user already holds an identity here");
    // The failure is not attributed to a control that is filled in correctly.
    expect(organization.getAttribute("aria-invalid")).toBeNull();
  });
});
