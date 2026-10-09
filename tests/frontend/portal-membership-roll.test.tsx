// @vitest-environment jsdom
/**
 * The consortium's roll: one row per membership, with the two commands a
 * membership has once it exists, and the routes that reach the grant and edit
 * pages. Granting itself is covered in portal-membership-members.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  memberUpdateSchema,
  staffMembersListResponseSchema,
  type StaffMemberSummary,
} from "../../assets/shared/schemas/members-directory";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { MemberEditForm } from "../../assets/ts/member-flows/portal/sections/membership-members/MemberEditForm";
import { MembersList } from "../../assets/ts/member-flows/portal/sections/membership-members/MembersList";
import { Members } from "../../assets/ts/member-flows/portal/sections/membership-members";
import { catalogEntry } from "./helpers/membership-roll-fixtures";
import { confirmationButton, confirmationConsequences } from "./helpers/confirm-dialog";
import { controlFor, optionValues, submitForm } from "./helpers/labelled-control";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";

const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/members", navigate] }));
vi.mock("../../assets/ts/hooks/useMembershipCategoryCatalog", () => ({
  useMembershipCategoryCatalog: () => [
    catalogEntry("A", "Organization member", false),
    catalogEntry("H5", "Student", true),
    catalogEntry("H6", "Individual supporter", true),
    catalogEntry("H7", "Community member", true),
  ],
}));

const individual: StaffMemberSummary = {
  id: "10000000-0000-4000-8000-000000000001",
  memberType: "individual",
  name: "Ada Lovelace",
  organizationId: null,
  userId: "20000000-0000-4000-8000-000000000001",
  imageUrl: null,
  membershipCategory: "H6",
  membershipCategoryLabel: "Individual supporter",
  status: "active",
  representativeCount: 1,
  memberSince: "2026-01-01",
};
const organization: StaffMemberSummary = {
  ...individual,
  id: "10000000-0000-4000-8000-000000000002",
  memberType: "organization",
  name: "Example Corp",
  organizationId: "30000000-0000-4000-8000-000000000001",
  userId: null,
  membershipCategory: "A",
  membershipCategoryLabel: "Organization member",
  status: "inactive",
  representativeCount: 3,
};

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

interface Recorded {
  method: string;
  url: URL;
  body?: unknown;
}

/** Serves the roll, and answers each membership command with the changed row. */
function stubRoll(members: StaffMemberSummary[], write?: (url: URL) => Response): Recorded[] {
  const requests: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      requests.push({ method, url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      if (method !== "GET") {
        return (
          write?.(url) ??
          json({
            member: { id: individual.id, memberType: "individual", membershipCategory: "H6", status: "inactive" },
          })
        );
      }
      const wanted = url.searchParams.get("memberId");
      const rows = wanted ? members.filter((member) => member.id === wanted) : members;
      return json(
        staffMembersListResponseSchema.parse({
          members: rows,
          page: { limit: 50, offset: 0, total: rows.length, hasMore: false },
        }),
      );
    }),
  );
  return requests;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  navigate.mockReset();
  vi.unstubAllGlobals();
});

describe("the members roll", () => {
  it("marks each row's kind by name and shows the category label with its code", async () => {
    stubRoll([individual, organization]);
    const root = mount(<MembersList categories={[]} canWrite onEditMember={() => undefined} />);
    await settle();

    const rows = [...root.querySelectorAll("tbody tr")];
    expect(rows[0]?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Individual");
    expect(rows[1]?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Organization");
    expect(rows[0]?.textContent).toContain("H6");
    expect(rows[1]?.textContent).toContain("Inactive");
  });

  it("asks the server for the staff projection and offers no row commands without membership:write", async () => {
    const requests = stubRoll([individual]);
    const root = mount(<MembersList categories={[]} canWrite={false} onEditMember={() => undefined} />);
    await settle();

    expect(requests[0]?.url.searchParams.get("view")).toBe("staff");
    expect(rowActionControlNames(root)).toEqual([]);
  });

  it("opens the edit page for a membership from its row", async () => {
    stubRoll([individual]);
    const onEditMember = vi.fn();
    const root = mount(<MembersList categories={[]} canWrite onEditMember={onEditMember} />);
    await settle();

    await runRowAction(root, individual.name, "Edit membership");
    expect(onEditMember).toHaveBeenCalledWith(individual.id);
  });

  it("ends a membership only after confirming it, and records the standing rather than deleting", async () => {
    const requests = stubRoll([individual]);
    const root = mount(
      <>
        <MembersList categories={[]} canWrite onEditMember={() => undefined} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();

    await runRowAction(root, individual.name, "End membership");
    expect(confirmationConsequences()).toEqual([
      "The membership is recorded as ended rather than removed",
      "They keep their account and lose what the membership gave them",
    ]);
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
    await act(async () => confirmationButton("End membership")!.click());
    await settle();

    const patch = requests.find(({ method }) => method === "PATCH")!;
    expect(patch.url.pathname).toBe(`/api/v1/members/${individual.id}`);
    expect(memberUpdateSchema.parse(patch.body)).toEqual({ status: "inactive" });
    // The roll is read again, so the row states its new standing.
    expect(requests.filter(({ method }) => method === "GET").length).toBeGreaterThan(1);
  });

  it("offers to reinstate an ended membership instead of ending it again", async () => {
    const requests = stubRoll([organization]);
    const root = mount(
      <>
        <MembersList categories={[]} canWrite onEditMember={() => undefined} />
        <ConfirmDialogHost />
      </>,
    );
    await settle();

    await runRowAction(root, organization.name, "Reinstate membership");
    await act(async () => confirmationButton("Reinstate membership")!.click());
    await settle();

    expect(memberUpdateSchema.parse(requests.find(({ method }) => method === "PATCH")?.body)).toEqual({
      status: "active",
    });
  });
});

describe("editing a membership", () => {
  it("offers only the categories this kind of membership can hold", async () => {
    stubRoll([individual, organization]);
    const person = mount(
      <MemberEditForm
        memberId={individual.id}
        categories={[
          catalogEntry("A", "Organization member", false),
          catalogEntry("H6", "Individual supporter", true),
          catalogEntry("H7", "Community member", true),
        ]}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await settle();
    expect(optionValues(controlFor<HTMLSelectElement>(person, "Category"))).toEqual(["H6", "H7"]);

    const company = mount(
      <MemberEditForm
        memberId={organization.id}
        categories={[catalogEntry("A", "Organization member", false), catalogEntry("H6", "Individual supporter", true)]}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await settle();
    expect(optionValues(controlFor<HTMLSelectElement>(company, "Category"))).toEqual(["A"]);
  });

  it("saves a changed category through the shared contract and returns to the roll", async () => {
    const requests = stubRoll([individual]);
    const onSaved = vi.fn();
    const root = mount(
      <MemberEditForm
        memberId={individual.id}
        categories={[catalogEntry("H6", "Individual supporter", true), catalogEntry("H7", "Community member", true)]}
        onSaved={onSaved}
        onCancel={() => undefined}
      />,
    );
    await settle();

    const category = controlFor<HTMLSelectElement>(root, "Category");
    category.value = "H7";
    await act(async () => {
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submitForm(root);
    await settle();

    const patch = requests.find(({ method }) => method === "PATCH")!;
    expect(memberUpdateSchema.parse(patch.body)).toEqual({ membershipCategory: "H7", status: "active" });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("says so when the membership cannot be found", async () => {
    stubRoll([]);
    const root = mount(
      <MemberEditForm memberId="missing" categories={[]} onSaved={() => undefined} onCancel={() => undefined} />,
    );
    await settle();

    expect(root.textContent).toContain("That membership could not be found.");
    expect(root.querySelector("form")).toBeNull();
  });
});

describe("the members routes", () => {
  it("sends a reader without the grant permission from the grant page back to the roll", async () => {
    stubRoll([]);
    mount(<Members canGrant={false} canWrite memberSegment="grant" />);
    await settle();

    expect(navigate).toHaveBeenCalledWith("/members");
  });

  it("sends a reader without membership:write from a membership's edit page back to the roll", async () => {
    stubRoll([individual]);
    mount(<Members canGrant canWrite={false} memberSegment={individual.id} />);
    await settle();

    expect(navigate).toHaveBeenCalledWith("/members");
  });

  it("gives the grant its own address from the roll's toolbar", async () => {
    stubRoll([]);
    const root = mount(<Members canGrant canWrite />);
    await settle();

    const grant = [...root.querySelectorAll("button")].find((button) => button.textContent === "Grant membership");
    await act(async () => grant!.click());
    expect(navigate).toHaveBeenCalledWith("/members/grant");
  });
});
