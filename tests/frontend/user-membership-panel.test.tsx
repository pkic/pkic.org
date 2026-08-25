// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMembershipPanel } from "../../assets/ts/admin/sections/users/UserMembershipPanel";
import type { UserDetail, UserMembership } from "../../assets/ts/admin/sections/users/model";

const mounted: HTMLElement[] = [];

function membership(
  memberId: string,
  organizationName: string,
  category: string,
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
      headshot_r2_key: null,
      headshot_updated_at: null,
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

    void act(() => render(<UserMembershipPanel user={user} onChanged={vi.fn()} />, container));

    expect(container.textContent).toContain("Organization A");
    expect(container.textContent).toContain("PQC Working Group");
    expect(container.textContent).toContain("Organization B");
    expect(container.textContent).toContain("Cryptographic Module Working Group");
    expect(container.textContent).toContain("Add organization representation");
  });
});
