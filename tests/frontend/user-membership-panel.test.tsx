// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMembershipPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserMembershipPanel";
import { UserMembershipCard } from "../../assets/ts/member-flows/portal/sections/system-users/UserMembershipCard";
import type { UserDetail, UserMembership } from "../../assets/ts/member-flows/portal/sections/system-users/model";
import type { MembershipCategory } from "../../assets/shared/schemas/membership-categories";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";

const mounted: HTMLElement[] = [];

function membership(
  memberId: string,
  organizationName: string,
  category: MembershipCategory,
  groupSlug: string,
  groupName: string,
): UserMembership {
  return {
    memberId,
    membershipCategory: category,
    status: "active",
    showOnOrgProfile: true,
    organizationId: `organization-${memberId}`,
    organizationName,
    createdAt: "2026-08-01T00:00:00.000Z",
    groups: [
      {
        id: `group-${memberId}`,
        slug: groupSlug,
        name: groupName,
        type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
      },
    ],
  };
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("UserMembershipPanel", () => {
  it("renders each organization capacity with only its own groups", () => {
    const user: UserDetail = {
      id: "user-1",
      email: "multiple@example.test",
      first_name: "Multiple",
      last_name: "Representative",
      preferred_name: null,
      organization_name: null,
      job_title: null,
      biography: null,
      links: [],
      role: "user",
      active: true,
      isEcMember: false,
      headshotUrl: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      pii_redacted_at: null,
      memberships: [
        membership("member-a", "Organization A", "A", "pqc", "PQC Working Group"),
        membership("member-b", "Organization B", "B", "cm", "Cryptographic Module Working Group"),
      ],
    };
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);

    void act(() => render(<UserMembershipPanel user={user} onChanged={vi.fn()} canManage />, container));

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("PQC Working Group");
    expect(container.textContent).toContain("Organization B");
    expect(container.textContent).toContain("Cryptographic Module Working Group");
    expect(container.textContent).toContain("Add organization representation");
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it("updates a capacity through the canonical capacity route", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          "https://app.test",
        );
        requests.push(url);
        return new Response(
          JSON.stringify({
            member: {
              id: "member-individual",
              userId: "user-1",
              organizationId: null,
              membershipCategory: "H5",
              status: "active",
              showOnOrgProfile: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const individual = membership("member-individual", "", "H5", "pqc", "PQC Working Group");
    individual.organizationId = null;
    individual.organizationName = null;
    individual.showOnOrgProfile = false;
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() =>
      render(<UserMembershipCard membership={individual} onChanged={async () => {}} canManage />, container),
    );
    const category = container.querySelector("select") as HTMLSelectElement;
    category.value = "H6";
    await act(async () => {
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(requests[0]?.pathname).toBe("/api/v1/members/capacities/member-individual");
  });

  it("only removes a membership through the confirm dialog when the removal is confirmed", async () => {
    const requests: Array<{ method: string; pathname: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          "https://app.test",
        );
        requests.push({ method: init?.method ?? "GET", pathname: url.pathname });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const org = membership("member-org", "Organization A", "A", "pqc", "PQC Working Group");
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <UserMembershipCard membership={org} onChanged={async () => {}} canManage />
        </>,
        container,
      ),
    );

    function dialogButton(label: string): HTMLButtonElement {
      const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
      if (!button) throw new Error(`missing button: ${label}`);
      return button;
    }

    void act(() => dialogButton("Remove membership").click());
    expect(container.textContent).toContain("Remove the membership for Organization A?");
    void act(() => dialogButton("Cancel").click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(requests).toHaveLength(0);

    void act(() => dialogButton("Remove membership").click());
    await act(() => dialogButton("Remove membership").click());
    expect(requests[0]).toMatchObject({ method: "DELETE", pathname: "/api/v1/members/capacities/member-org" });
  });
});
