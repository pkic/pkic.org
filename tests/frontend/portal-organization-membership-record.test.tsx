// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationDetailResponseSchema } from "../../assets/shared/schemas/organization-management";
import { OrganizationMembershipCard } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationProfile";
import { draftFromOrganization } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDraft";
import { organizationProfile } from "./helpers/organization-self-service";
import { exampleMembershipCategories } from "./helpers/membership-category-catalog";
vi.mock("../../assets/ts/hooks/useMembershipCategoryCatalog", () => ({
  useMembershipCategoryCatalog: () => exampleMembershipCategories,
}));
let container: HTMLDivElement | undefined;
afterEach(() => {
  const mounted = container;
  if (mounted) {
    void act(() => render(null, mounted));
    mounted.remove();
  }
});

describe("organization membership record", () => {
  it.each([null, "2026-01-01"])("omits a member page and handles membership date %s", (memberSince) => {
    const detail = organizationDetailResponseSchema.parse({
      organization: {
        ...organizationProfile(),
        publicProfileHref: null,
        membershipCategory: null,
        memberSince,
        activeIdentityCount: 0,
        primaryContactName: null,
        primaryContactEmail: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        primaryContactUserId: null,
        secondaryContactUserId: null,
        emailDomains: [],
        claimedDomains: [],
        mergedInto: null,
        identities: [],
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    void act(() => render(<OrganizationMembershipCard organization={detail.organization} />, container!));
    const terms = [...container.querySelectorAll("dt")].map((term) => term.textContent);
    expect(terms.includes("Member since")).toBe(memberSince !== null);
    expect(terms).not.toContain("Member page");
    expect(container.querySelector('a[href^="/members/"]')).toBeNull();
    expect(draftFromOrganization(detail.organization).memberSince).toBe(memberSince ?? "");
  });
});
