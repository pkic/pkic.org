import type { PortalSession } from "../../assets/ts/member-flows/portal/types";

export function portalSessionFixture(capacities: { admin?: boolean; member?: boolean }): PortalSession {
  const identity = { id: "00000000-0000-4000-8000-000000000001", email: "person@example.test" };
  return {
    success: true,
    identity,
    ...(capacities.admin
      ? {
          admin: {
            ...identity,
            role: "admin",
            scopes: [],
            grants: [],
            expiresAt: "2026-08-26T00:00:00.000Z",
          },
        }
      : {}),
    ...(capacities.member
      ? {
          member: {
            userId: identity.id,
            email: identity.email,
            memberId: "00000000-0000-4000-8000-000000000002",
            organizationId: null,
            membershipCategory: "H5",
            isEcMember: false,
          },
        }
      : {}),
  };
}
