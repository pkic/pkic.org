import type { PortalSession } from "../../assets/ts/member-flows/portal/types";

interface PortalSessionFixtureOptions {
  staff?: boolean;
  member?: boolean;
  staffRole?: string;
  grants?: Array<{ permission: string; contextType: string | null; contextId: string | null }>;
}

export function portalSessionFixture(capacities: PortalSessionFixtureOptions): PortalSession {
  const identity = { id: "00000000-0000-4000-8000-000000000001", email: "person@example.test" };
  return {
    success: true,
    identity,
    ...(capacities.staff
      ? {
          staff: {
            ...identity,
            role: capacities.staffRole ?? "admin",
            scopes: [],
            grants: capacities.grants ?? [],
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
