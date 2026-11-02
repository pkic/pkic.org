// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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
// The affiliations panel routes its add command; the mock keeps the router out.
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
import { UserAffiliationsPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationsPanel";
import { UserAffiliationRow } from "../../assets/ts/member-flows/portal/sections/system-users/UserAffiliationRow";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { identityUpdateSchema } from "../../assets/shared/schemas/identity";
import { memberCapacityUpdateSchema } from "../../assets/shared/schemas/membership-management";
import { buttonNamed, chooseOption, controlFor, typeInto } from "./helpers/labeled-control";
import { menuItemNamed } from "./helpers/row-actions";
import { formatTenure } from "../../assets/shared/format-date";
import { instantToCalendarDate, viewerTimeZone } from "../../assets/shared/timezone";
import {
  GROUP_ID,
  IDENTITY_ID,
  MEMBER_ID,
  ORGANIZATION_ID,
  USER_ID,
  identityMutation,
  jsonResponse,
  membership,
  menuTrigger,
  mount,
  press,
  runRowMenuAction,
  settle,
  stubFetch,
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
    // The panel's own action is an icon button in its header, not competing with the ties.
    expect(container.querySelector('button[aria-label="Add identity"]')).not.toBeNull();
    // An organization-tied capacity takes its category and status from the
    // organization, so neither is editable here.
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });

  it("states the terms of the tie and names the change its visibility action makes", async () => {
    const container = mount();
    void act(() =>
      render(
        <UserAffiliationRow
          userId="00000000-0000-4000-8000-0000000000aa"
          membership={membership()}
          onChanged={async () => {}}
          canManage
        />,
        container,
      ),
    );

    // The terms of the tie read as a list rather than a run-on sentence, so
    // the separators between them stay presentational and are never announced.
    // The groups are not among them: they are positions, under the entry.
    const terms = [...container.querySelectorAll(".pk-affiliation__detail > ul.pk-affiliation__terms > li")].map(
      (term) => term.textContent,
    );
    expect(terms).toEqual([formatTenure("2026-08-01T00:00:00.000Z", null), "role@organization-a.example"]);
    expect(container.textContent).not.toContain("PQC Working Group");

    // The visibility control is a menu item now, so it names the change it
    // will make; the marker beside the name is what states where things stand.
    void act(() => menuTrigger(container, "Actions for Organization A").click());
    expect(menuItemNamed(container, "Hide from Organization A's public profile")).not.toBeNull();
  });

  it("heads the entry with the position, lists its group seats and marks the acting identity", async () => {
    const container = mount();
    void act(() =>
      render(
        <UserAffiliationRow
          userId={USER_ID}
          membership={membership({ jobTitle: "Solution architect" })}
          onChanged={async () => {}}
          canManage={false}
          viewerIsSubject
          acting
          seats={[
            {
              group: {
                id: GROUP_ID,
                slug: "pqc",
                name: "PQC Working Group",
                type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
              },
              identityId: IDENTITY_ID,
              title: "Chair",
              joinedAt: "2026-02-01T00:00:00.000Z",
              leftAt: null,
              attended: 3,
              held: 4,
              lastAttendedAt: null,
            },
          ]}
        />,
        container,
      ),
    );

    // The position heads the entry; the organization it is held at follows, as the link.
    expect(container.querySelector(".pk-affiliation__name > .pk-strong")?.textContent).toBe("Solution architect");
    expect(container.querySelector<HTMLAnchorElement>(".pk-affiliation__subtitle a")?.textContent).toBe(
      "Organization A",
    );
    expect(container.textContent).toContain("You're acting as this identity now");

    // The seat opens its group; attendance is stated once on the record, not per seat.
    const roles = container.querySelector('ul[aria-label="Group roles"]')!;
    const link = roles.querySelector<HTMLAnchorElement>(`a[href="#/groups/${GROUP_ID}"]`);
    expect(link?.textContent).toBe("PQC Working Group");
    expect(roles.textContent).toContain("Chair, PQC Working Group");
    expect(roles.querySelector('[role="meter"]')).toBeNull();
  });

  it("says when the organization follows the person's work email domain", async () => {
    const linked = membership({ organizationEmailDomain: "organization-a.example" });
    const container = mount();
    void act(() =>
      render(
        <UserAffiliationRow
          userId="00000000-0000-4000-8000-0000000000aa"
          membership={linked}
          onChanged={async () => {}}
          canManage={false}
          viewerIsSubject
        />,
        container,
      ),
    );
    const terms = () =>
      [...container.querySelectorAll("ul.pk-affiliation__terms > li")].map((term) => term.textContent);
    expect(terms()).toContain("from your @organization-a.example email");

    void act(() =>
      render(
        <UserAffiliationRow
          userId="00000000-0000-4000-8000-0000000000aa"
          membership={linked}
          onChanged={async () => {}}
          canManage={false}
        />,
        container,
      ),
    );
    expect(terms()).toContain("from their @organization-a.example email");
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
      render(
        <UserAffiliationRow
          userId="00000000-0000-4000-8000-0000000000aa"
          membership={individual}
          onChanged={async () => {}}
          canManage
        />,
        container,
      ),
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
      render(
        <UserAffiliationRow
          userId="00000000-0000-4000-8000-0000000000aa"
          membership={individual}
          onChanged={async () => {}}
          canManage
        />,
        container,
      ),
    );

    // The category is stated on the row, not editable on arrival: it opens
    // only once the row's own menu is asked for it (#47).
    expect(container.querySelector("select")).toBeNull();
    runRowMenuAction(container, "Individual member", "Edit membership…");

    await chooseOption(controlFor<HTMLSelectElement>(container, "Category"), "H6");
    await settle();
    // Choosing writes nothing: the row is a draft until it is saved (#91).
    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
    await press(container, "Save");

    // The capacity route is keyed by the identity, not the member aggregate:
    // sending the member id came back as "Active identity not found" (#91).
    expect(requests.find((request) => request.method === "PATCH")?.pathname).toBe(
      `/api/v1/members/capacities/${IDENTITY_ID}`,
    );
    expect(memberCapacityUpdateSchema.parse(requests.find((request) => request.method === "PATCH")?.body)).toEqual({
      membershipCategory: "H6",
    });
  });

  it.each([
    ["Organization A", membership(), true, "Edit profile…"],
    ["Organization A", membership(), false, "Edit identity profile…"],
  ] as const)("opens the profile editor page from the menu (%#)", (title, tie, viewerIsSubject, label) => {
    // The profile is a detailed form, so the menu leads to a page of its own rather than opening it in the row.
    const container = mount();
    void act(() =>
      render(
        <UserAffiliationRow
          userId="00000000-0000-4000-8000-0000000000aa"
          membership={tie}
          onChanged={vi.fn()}
          canManage
          viewerIsSubject={viewerIsSubject}
        />,
        container,
      ),
    );
    void act(() => menuTrigger(container, `Actions for ${title}`).click());
    const item = menuItemNamed(container, label);
    expect(item?.getAttribute("href")).toContain(
      `/users/00000000-0000-4000-8000-0000000000aa/affiliations/${IDENTITY_ID}/profile`,
    );
    expect(container.textContent).not.toContain("Save changes");
  });

  it("ends a nonmember organization identity through its canonical organization route", async () => {
    const requests = stubFetch(() => identityMutation("ended"));
    const nonmember = membership({ memberId: null, membershipCategory: null, status: null });
    const container = mount();
    void act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <UserAffiliationRow
            userId="00000000-0000-4000-8000-0000000000aa"
            membership={nonmember}
            onChanged={vi.fn()}
            canManage
          />
        </>,
        container,
      ),
    );

    runRowMenuAction(container, "Organization A", "End representation…");
    await press(container, "End representation");
    const mutations = requests.filter((request) => request.method !== "GET");
    expect(mutations).toHaveLength(1);
    expect(mutations[0].pathname).toBe(`/api/v1/organizations/${ORGANIZATION_ID}/identities/${IDENTITY_ID}`);
    expect(identityUpdateSchema.parse(mutations[0].body)).toEqual({
      transition: { state: "ended", reason: "Ended from System Users" },
    });
    expect(requests.some((request) => request.pathname.startsWith("/api/v1/members/"))).toBe(false);
  });

  it("only removes a membership through the confirm dialog when the removal is confirmed", async () => {
    const requests = stubFetch(() => identityMutation("ended"));
    const container = mount();
    void act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <UserAffiliationRow
            userId="00000000-0000-4000-8000-0000000000aa"
            membership={membership()}
            onChanged={async () => {}}
            canManage
          />
        </>,
        container,
      ),
    );

    runRowMenuAction(container, "Organization A", "End representation…");
    expect(container.textContent).toContain("End this person's representation of Organization A?");
    expect(container.textContent).toContain("Ended by mistake? You can reinstate it from their past identities");
    void act(() => buttonNamed(container, "Cancel").click());
    await settle();
    expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);

    runRowMenuAction(container, "Organization A", "End representation…");
    await press(container, "End representation");
    expect(requests.find((request) => request.method === "PATCH")).toMatchObject({
      method: "PATCH",
      pathname: `/api/v1/organizations/${ORGANIZATION_ID}/identities/${IDENTITY_ID}`,
    });
    expect(identityUpdateSchema.parse(requests.find((request) => request.method === "PATCH")?.body)).toEqual({
      transition: { state: "ended", reason: "Ended from System Users" },
    });
  });

  describe("ending a representation as the subject", () => {
    function mountSubjectRow(): HTMLElement {
      const container = mount();
      void act(() =>
        render(
          <>
            <ConfirmDialogHost />
            <UserAffiliationRow
              userId="00000000-0000-4000-8000-0000000000aa"
              membership={membership()}
              onChanged={vi.fn()}
              canManage
              viewerIsSubject
            />
          </>,
          container,
        ),
      );
      return container;
    }

    function dayOffset(days: number): string {
      return instantToCalendarDate(new Date(Date.now() + days * 86_400_000), viewerTimeZone());
    }

    it("sends no end instant when the representation ends today", async () => {
      const requests = stubFetch(() => identityMutation("ended"));
      const container = mountSubjectRow();

      runRowMenuAction(container, "Organization A", "End representation…");
      expect(container.textContent).toContain("End your representation of Organization A?");
      expect(container.textContent).toContain(
        "Ended by mistake? You can reinstate it by confirming your work email address",
      );
      expect(controlFor(container, "Ended on").getAttribute("name")).toBe("endedAt");
      expect(controlFor<HTMLInputElement>(container, "Ended on").value).toBe(dayOffset(0));
      await press(container, "End representation");

      const mutations = requests.filter((request) => request.method !== "GET");
      expect(mutations).toHaveLength(1);
      expect(mutations[0].pathname).toBe(`/api/v1/users/current/identities/${IDENTITY_ID}`);
      expect(mutations[0].body).toEqual({ transition: { state: "ended" } });
    });

    it("sends the end of the chosen earlier day", async () => {
      const requests = stubFetch(() => identityMutation("ended"));
      const container = mountSubjectRow();

      runRowMenuAction(container, "Organization A", "End representation…");
      const earlier = dayOffset(-3);
      await typeInto(controlFor(container, "Ended on"), earlier);
      await press(container, "End representation");

      const mutations = requests.filter((request) => request.method !== "GET");
      expect(mutations).toHaveLength(1);
      const endedAt = (mutations[0].body as { transition: { state: string; endedAt: string } }).transition.endedAt;
      expect(mutations[0].body).toEqual({ transition: { state: "ended", endedAt } });
      expect(endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // 23:59 that day in the viewer's zone, so the chosen day is the one the instant falls on there.
      expect(instantToCalendarDate(endedAt, viewerTimeZone())).toBe(earlier);
      expect(Date.parse(endedAt)).toBeLessThan(Date.now());
    });

    it("refuses a future day at the field and sends nothing", async () => {
      const requests = stubFetch(() => identityMutation("ended"));
      const container = mountSubjectRow();

      runRowMenuAction(container, "Organization A", "End representation…");
      await typeInto(controlFor(container, "Ended on"), dayOffset(3));
      await press(container, "End representation");

      expect(container.textContent).toContain("The end date can't be in the future");
      expect(requests.filter((request) => request.method !== "GET")).toHaveLength(0);
    });
  });

  it("offers an individual membership an End membership action", () => {
    const individual = membership({
      membershipCategory: "H5",
      organizationId: null,
      organizationName: null,
      showOnOrgProfile: false,
    });
    const container = mount();
    void act(() =>
      render(
        <UserAffiliationRow
          userId="00000000-0000-4000-8000-0000000000aa"
          membership={individual}
          onChanged={vi.fn()}
          canManage
        />,
        container,
      ),
    );
    void act(() => menuTrigger(container, "Actions for Individual member").click());
    expect(menuItemNamed(container, "End membership…")).not.toBeNull();
    expect(menuItemNamed(container, "End representation…")).toBeNull();
  });
});

it.each([true, false])("exposes Delete identity to its authorized owner or staff (owner: %s)", async (owner) => {
  const requests = stubFetch(() => jsonResponse({ success: true }));
  const container = mount();
  await act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <UserAffiliationRow
          userId="00000000-0000-4000-8000-000000000001"
          membership={membership()}
          onChanged={async () => {}}
          canManage={!owner}
          viewerIsSubject={owner}
          canRemoveIdentity={!owner}
        />
      </>,
      container,
    ),
  );
  runRowMenuAction(container, "Organization A", "Delete identity…");
  await settle();
  await press(document.body, "Delete identity");
  const mutations = requests.filter((request) => request.method === "DELETE");
  expect(mutations).toHaveLength(1);
  expect(mutations[0]!.pathname).toBe(`/api/v1/users/00000000-0000-4000-8000-000000000001/identities/${IDENTITY_ID}`);
});

it("opens correction when deletion finds linked participation", async () => {
  const onCorrect = vi.fn();
  stubFetch(() =>
    jsonResponse(
      { error: { code: "IDENTITY_HAS_PARTICIPATION", message: "Choose a replacement representation." } },
      409,
    ),
  );
  const container = mount();
  await act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <UserAffiliationRow
          userId={USER_ID}
          membership={membership()}
          onChanged={async () => {}}
          canManage
          canRemoveIdentity
          onCorrect={onCorrect}
        />
      </>,
      container,
    ),
  );
  runRowMenuAction(container, "Organization A", "Delete identity…");
  await settle();
  await press(document.body, "Delete identity");
  expect(onCorrect).toHaveBeenCalledTimes(1);
});
