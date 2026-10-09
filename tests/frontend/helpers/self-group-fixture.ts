/** A joinable working group as the self-service groups API returns it; tests override what they exercise. */
import type { SelfGroup } from "../../../assets/shared/schemas/group-participation";

export function group(overrides: Partial<SelfGroup> = {}): SelfGroup {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "architecture",
    abbreviatedName: null,
    name: "Architecture Group",
    type: { key: "working_group", singularLabel: "Working group", pluralLabel: "Working groups" },
    parentGroup: null,
    description: "Architecture collaboration",
    links: [],
    visibility: "public",
    governanceInheritanceMode: "inherited",
    eligibilityMode: "open",
    automaticEnrollmentMode: "none",
    allowAutomaticOptOut: false,
    publicLeadership: false,
    publicRoster: false,
    minEndorsersForBallot: 0,
    active: true,
    revision: 0,
    membershipCapacityCount: 0,
    representedMemberCount: 0,
    participantCount: 0,
    childCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    eligibleCapacities: [
      {
        memberId: "20000000-0000-4000-8000-000000000001",
        memberType: "organization",
        organizationName: "Organization A",
        membershipCategory: "A",
      },
      {
        memberId: "20000000-0000-4000-8000-000000000002",
        memberType: "organization",
        organizationName: "Organization B",
        membershipCategory: "B",
      },
    ],
    memberships: [],
    ...overrides,
  };
}
