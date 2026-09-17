// @vitest-environment jsdom
import { exampleMembershipCategories } from "./helpers/membership-category-catalog";
vi.mock("../../assets/ts/hooks/useMembershipCategoryCatalog", () => ({
  useMembershipCategoryCatalog: () => exampleMembershipCategories,
}));
/**
 * The affiliations panel: the collection, and what may be added to it.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
// The panel's own command navigates to the grant page (#107); the mock keeps
// the router out of the test and records where it was sent.
const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));
import { UserAffiliationsPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationsPanel";
import { UserIdentityGrantForm } from "../../assets/ts/member-flows/portal/sections/system-users/UserIdentityGrantForm";
import { identityCreateSchema } from "../../assets/shared/schemas/identity";
import { individualMembershipGrantSchema } from "../../assets/shared/schemas/membership-management";
import { organizationIdentityCreateRequestSchema } from "../../assets/shared/schemas/route-contracts-identities";
import { normalizeValidation } from "../../assets/ts/shared/form/validation-map";
import { buttonNamed, chooseComboboxOption, chooseOption, controlFor, typeInto } from "./helpers/labelled-control";
import { menuItemNamed } from "./helpers/row-actions";
import {
  MEMBER_ID,
  PICKED_ORGANIZATION_ID,
  USER_ID,
  describedByText,
  errorResponse,
  fieldOf,
  fieldRefusal,
  jsonResponse,
  menuTrigger,
  mount,
  press,
  settle,
  stubFetch,
  toastArea,
  userWith,
  organizationDetail,
  organizationList,
} from "./helpers/affiliation-fixtures";

describe("UserAffiliationsPanel", () => {
  it("exposes the empty membership list as a live status region", () => {
    const container = mount();
    void act(() => render(<UserAffiliationsPanel user={userWith([])} onChanged={vi.fn()} canManage />, container));

    expect(container.querySelector('[role="status"]')?.textContent).toContain("No active identities.");
  });

  // The grant form is a page under the record (#107); the panel's command
  // only leads there, so the form is mounted the way the route mounts it.
  function openGrantForm(): HTMLElement {
    const container = mount();
    void act(() =>
      render(
        <UserIdentityGrantForm user={userWith([])} canActivate onGranted={() => {}} cancelHref="/users/user-1" />,
        container,
      ),
    );
    return container;
  }

  it("leads to the identity grant page rather than unfolding a form in the panel", () => {
    const container = mount();
    void act(() =>
      render(<UserAffiliationsPanel user={userWith([])} onChanged={async () => {}} canManage />, container),
    );
    void act(() => menuTrigger(container, "Affiliation settings").click());
    const add = menuItemNamed(container, "Add identity…");
    if (!add) throw new Error('the panel offers no "Add identity…"');
    void act(() => add.click());
    expect(container.querySelector("form")).toBeNull();
    expect(navigate).toHaveBeenCalledWith(`/users/${USER_ID}/affiliations/new`);
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
    const container = openGrantForm();

    await press(container, "Grant");

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

  it("grants an individual capacity through the member capacities contract, refusing a blank reason first", async () => {
    const requests = stubFetch(() =>
      jsonResponse({
        member: {
          id: MEMBER_ID,
          userId: USER_ID,
          organizationId: null,
          membershipCategory: "H5",
          status: "active",
          showOnOrgProfile: false,
        },
      }),
    );
    const container = openGrantForm();

    await chooseOption(controlFor<HTMLSelectElement>(container, "Category"), "H5");
    // Whitespace clears the browser's own `required` check, so the grant
    // contract is what refuses the blank reason — on its field, sending nothing.
    const reason = controlFor(container, "Activation reason");
    await typeInto(reason, "   ");
    await press(container, "Grant");

    expect(fieldOf(reason).classList.contains("pk-field--invalid")).toBe(true);
    expect(fieldOf(reason).querySelector('[role="alert"]')?.textContent).toContain(
      "Document why this identity is being activated immediately.",
    );
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);

    await typeInto(reason, "  Individual member since the 2026 AGM  ");
    await press(container, "Grant");

    const post = requests.find((request) => request.method === "POST");
    expect(post?.pathname, container.textContent ?? "").toBe("/api/v1/members/capacities");
    // Parsed through the route's own contract rather than compared to a
    // literal copy of what the form sent.
    expect(individualMembershipGrantSchema.parse(post?.body)).toEqual({
      userId: USER_ID,
      membershipCategory: "H5",
      activationReason: "Individual member since the 2026 AGM",
    });
  });

  it("marks the field a server refusal names, and keeps the form open", async () => {
    stubFetch((url) => {
      if (url.pathname === "/api/v1/organizations") return jsonResponse(organizationList);
      if (url.pathname === `/api/v1/organizations/${PICKED_ORGANIZATION_ID}`) return jsonResponse(organizationDetail);
      return fieldRefusal({ organizationId: ["That organization cannot take identities."] });
    });
    const container = openGrantForm();

    const organization = await pickOrganizationOne(container);
    await press(container, "Grant");

    expect(fieldOf(organization).classList.contains("pk-field--invalid")).toBe(true);
    expect(fieldOf(organization).querySelector('[role="alert"]')?.textContent).toContain(
      "That organization cannot take identities.",
    );
    expect(document.activeElement).toBe(organization);
    expect(buttonNamed(container, "Grant")).toBeDefined();
  });

  it("requires a documented reason before activating an identity immediately", async () => {
    const requests = stubFetch((url) =>
      url.pathname === "/api/v1/organizations" ? jsonResponse(organizationList) : jsonResponse(organizationDetail),
    );
    const container = openGrantForm();

    await pickOrganizationOne(container);
    expect(container.textContent).toContain("Example A (A)");

    const activate = container.querySelector<HTMLInputElement>("input#identity-activate-immediately");
    await act(() => {
      activate!.checked = true;
      activate!.dispatchEvent(new Event("input", { bubbles: true }));
      activate!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Whitespace clears the browser's own `required` check, so the surface's
    // trim is the only thing standing between this and an undocumented
    // immediate activation.
    const reason = controlFor(container, "Activation reason");
    expect(reason.getAttribute("required")).not.toBeNull();
    await typeInto(reason, "   ");
    await press(container, "Grant");

    expect(fieldOf(reason).classList.contains("pk-field--invalid")).toBe(true);
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(describedByText(reason)).toContain("Document why this identity is being activated immediately.");
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);

    await typeInto(reason, "Board approved on 2026-08-30");
    await press(container, "Grant");

    const post = requests.find((request) => request.method === "POST");
    expect(post?.pathname).toBe(`/api/v1/organizations/${PICKED_ORGANIZATION_ID}/identities`);
    expect(identityCreateSchema.parse(post?.body)).toMatchObject({
      userReference: "existing_user",
      userId: USER_ID,
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
    const container = openGrantForm();

    const organization = await pickOrganizationOne(container);
    await press(container, "Grant");

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This user already holds an identity here",
    );
    expect(area.textContent).toContain("This user already holds an identity here");
    // The failure is not attributed to a control that is filled in correctly.
    expect(organization.getAttribute("aria-invalid")).toBeNull();
  });
});
