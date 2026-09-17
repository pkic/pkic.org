// @vitest-environment jsdom
import { exampleMembershipCategories } from "./helpers/membership-category-catalog";
vi.mock("../../assets/ts/hooks/useMembershipCategoryCatalog", () => ({
  useMembershipCategoryCatalog: () => exampleMembershipCategories,
}));
/**
 * One affiliation row: what the tie states, and the commands it offers.
 *
 * Split from the panel's own suite when the pair outgrew one file. This is
 * about a single tie — what a reader is told, which command writes through
 * which contract, and what the row refuses to open on arrival.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
// The affiliations panel routes its add command; the mock keeps the router out.
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
import { UserAffiliationsPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationsPanel";
import { UserAffiliationRow } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationRow";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { identityUpdateSchema } from "../../assets/shared/schemas/identity";
import { memberCapacityUpdateSchema } from "../../assets/shared/schemas/membership-management";
import { buttonNamed, chooseOption, controlFor, typeInto, typeMarkdown } from "./helpers/labelled-control";
import { menuItemNamed } from "./helpers/row-actions";
import {
  IDENTITY_ID,
  MEMBER_ID,
  ORGANIZATION_ID,
  USER_ID,
  errorResponse,
  identityMutation,
  jsonResponse,
  membership,
  menuTrigger,
  mount,
  press,
  runRowMenuAction,
  settle,
  stubFetch,
  toastArea,
  userWith,
} from "./helpers/affiliation-fixtures";

describe("UserAffiliationRow", () => {
  it("renders every organization capacity with the terms of its own tie", async () => {
    const user = userWith([
      membership(),
      membership({
        identityId: "00000000-0000-4000-8000-0000000000b3",
        memberId: "00000000-0000-4000-8000-0000000000b4",
        organizationId: "00000000-0000-4000-8000-0000000000b2",
        organizationName: "Organization B",
        membershipCategory: "B",
        groups: [
          {
            id: "00000000-0000-4000-8000-0000000000b5",
            slug: "cm",
            name: "Cryptographic Module Working Group",
            type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
          },
        ],
      }),
    ]);
    const container = mount();

    void act(() => render(<UserAffiliationsPanel user={user} onChanged={vi.fn()} canManage />, container));

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("Organization B");
    // Each tie carries its own address, which is what distinguishes two
    // affiliations held by one person. Their groups are not here: the record
    // states those once, in the participation table.
    expect(container.textContent).toContain("role@organization-a.example");
    expect(container.textContent).not.toContain("PQC Working Group");
    // The panel's own action is in its menu, not a button competing with the
    // ties the panel is about.
    expect(menuTrigger(container, "Affiliation settings")).toBeDefined();
    // An organization-tied capacity takes its category and status from the
    // organization, so neither is editable here.
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });

  it("states the terms of the tie and names the change its visibility action makes", async () => {
    const container = mount();
    void act(() =>
      render(<UserAffiliationRow membership={membership()} onChanged={async () => {}} canManage />, container),
    );

    // The terms of the tie read as a list rather than a run-on sentence, so
    // the separators between them stay presentational and are never announced.
    // The groups are not among them: the record states those once, in the
    // participation table, with the seat and the attendance beside them.
    const terms = [...container.querySelectorAll("ul.pk-affiliation__terms > li")].map((term) => term.textContent);
    expect(terms).toEqual(["since Aug 1, 2026", "role@organization-a.example"]);
    expect(container.textContent).not.toContain("PQC Working Group");

    // The visibility control is a menu item now, so it names the change it
    // will make; the marker beside the name is what states where things stand.
    void act(() => menuTrigger(container, "Actions for Organization A").click());
    expect(menuItemNamed(container, "Hide from Organization A's public profile")).not.toBeNull();
  });

  it("states a membership rather than opening it for editing", async () => {
    /*
     * Issue #47, on the surface my first pass at it missed. The category and
     * the standing are already on the row as two badges; they were *also* a
     * pair of open selects in the footer, which wrote on change — so a stray
     * click changed somebody's membership with nothing to confirm and nothing
     * to undo, and the record arrived in edit mode exactly as reported.
     */
    const individual = membership({
      membershipCategory: "H5",
      organizationId: null,
      organizationName: null,
      showOnOrgProfile: false,
    });
    const container = mount();
    void act(() =>
      render(<UserAffiliationRow membership={individual} onChanged={async () => {}} canManage />, container),
    );

    expect(container.querySelectorAll("select")).toHaveLength(0);
    // Stated, though: the reader can still see what the membership is.
    expect(container.textContent).toContain("H5");

    runRowMenuAction(container, "Individual member", "Edit membership…");
    expect(container.querySelectorAll("select").length).toBeGreaterThan(0);
  });

  it("updates a capacity through the canonical capacity route", async () => {
    const requests = stubFetch(() =>
      jsonResponse({
        member: {
          id: MEMBER_ID,
          userId: USER_ID,
          organizationId: null,
          membershipCategory: "H6",
          status: "active",
          showOnOrgProfile: false,
        },
      }),
    );
    const individual = membership({
      membershipCategory: "H5",
      organizationId: null,
      organizationName: null,
      showOnOrgProfile: false,
    });
    const container = mount();
    void act(() =>
      render(<UserAffiliationRow membership={individual} onChanged={async () => {}} canManage />, container),
    );

    // The category is stated on the row, not editable on arrival: it opens
    // only once the row's own menu is asked for it (#47).
    expect(container.querySelector("select")).toBeNull();
    runRowMenuAction(container, "Individual member", "Edit membership…");

    await chooseOption(controlFor<HTMLSelectElement>(container, "Category"), "H6");
    await settle();
    // Choosing writes nothing: the row is a draft until it is saved (#91).
    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
    await press(container, "Save membership");

    // The capacity route is keyed by the identity, not the member aggregate:
    // sending the member id came back as "Active identity not found" (#91).
    expect(requests.find((request) => request.method === "PATCH")?.pathname).toBe(
      `/api/v1/members/capacities/${IDENTITY_ID}`,
    );
    expect(memberCapacityUpdateSchema.parse(requests.find((request) => request.method === "PATCH")?.body)).toEqual({
      membershipCategory: "H6",
    });
  });

  it("edits an individual capacity's own profile through the capacity route", async () => {
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
    const individual = membership({
      membershipCategory: "H5",
      organizationId: null,
      organizationName: null,
      showOnOrgProfile: false,
      jobTitle: null,
      biography: "Independent researcher.",
    });
    const container = mount();
    void act(() =>
      render(<UserAffiliationRow membership={individual} onChanged={async () => {}} canManage />, container),
    );

    // An individual member has nobody's organization to write the profile
    // through: the row edits it on the capacity itself (#91). A job title is
    // a role at an organization, so the editor does not ask for one.
    runRowMenuAction(container, "Individual member", "Edit identity profile…");
    expect(container.textContent).not.toContain("Job title for");
    await typeMarkdown(container, "Biography for this membership", "Cryptography consultant.");
    await press(container, "Save identity profile");

    const patch = requests.find((request) => request.method === "PATCH");
    expect(patch?.pathname).toBe(`/api/v1/members/capacities/${IDENTITY_ID}`);
    expect(memberCapacityUpdateSchema.parse(patch?.body)).toEqual({
      profile: { biography: "Cryptography consultant.", links: [] },
    });
    expect(container.textContent).not.toContain("Save identity profile");
  });

  it("renders and edits organization-specific profile fields through the identity route", async () => {
    const requests = stubFetch(() => identityMutation("active"));
    const org = membership({
      jobTitle: "Standards lead",
      biography: "Represents Organization A.",
      links: ["https://organization-a.example/profile"],
    });
    const container = mount();
    void act(() => render(<UserAffiliationRow membership={org} onChanged={async () => {}} canManage />, container));

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("role@organization-a.example");
    expect(container.textContent).toContain("Standards lead");
    expect(container.textContent).toContain("Represents Organization A.");

    runRowMenuAction(container, "Organization A", "Edit identity profile…");
    await typeInto(controlFor(container, "Job title for Organization A"), "Updated standards lead");
    await press(container, "Save identity profile");

    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(1);
    expect(requests.find((request) => request.method === "PATCH")?.pathname).toBe(
      `/api/v1/organizations/${ORGANIZATION_ID}/identities/${IDENTITY_ID}`,
    );
    expect(identityUpdateSchema.parse(requests.find((request) => request.method === "PATCH")?.body)).toEqual({
      profile: {
        jobTitle: "Updated standards lead",
        biography: "Represents Organization A.",
        links: ["https://organization-a.example/profile"],
      },
    });
    // The editor closed only because the save succeeded: its Save control is
    // gone, and the menu offers to open it again.
    expect(container.textContent).not.toContain("Save identity profile");
  });

  it("keeps the identity editor open and reports the reason when the save fails", async () => {
    const area = toastArea();
    stubFetch(() => errorResponse("Job title is too long", 400));
    const container = mount();
    void act(() =>
      render(<UserAffiliationRow membership={membership()} onChanged={async () => {}} canManage />, container),
    );

    runRowMenuAction(container, "Organization A", "Edit identity profile…");
    await press(container, "Save identity profile");

    expect(area.textContent).toContain("Job title is too long");
    // Still editing: a failure must not throw away the unsaved values.
    expect(container.textContent).toContain("Save identity profile");
  });

  it("only removes a membership through the confirm dialog when the removal is confirmed", async () => {
    const requests = stubFetch(() => identityMutation("ended"));
    const container = mount();
    void act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <UserAffiliationRow membership={membership()} onChanged={async () => {}} canManage />
        </>,
        container,
      ),
    );

    runRowMenuAction(container, "Organization A", "End identity…");
    expect(container.textContent).toContain("End the identity for Organization A?");
    void act(() => buttonNamed(container, "Cancel").click());
    await settle();
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);

    runRowMenuAction(container, "Organization A", "End identity…");
    await press(container, "End identity");
    expect(requests.find((request) => request.method === "PATCH")).toMatchObject({
      method: "PATCH",
      pathname: `/api/v1/organizations/${ORGANIZATION_ID}/identities/${IDENTITY_ID}`,
    });
    expect(identityUpdateSchema.parse(requests.find((request) => request.method === "PATCH")?.body)).toEqual({
      transition: { state: "ended", reason: "Ended from System Users" },
    });
  });
});
