import { administratorGrants } from "./administrator-grants";
import type { PortalSession } from "../../assets/ts/member-flows/portal/types";

interface PortalSessionFixtureOptions {
  staff?: boolean;
  member?: boolean;
  administrator?: boolean;
  pendingIdentityCount?: number;
  grants?: Array<{ permission: string; contextType: string | null; contextId: string | null }>;
}

export function portalSessionFixture(capacities: PortalSessionFixtureOptions): PortalSession {
  const identity = { id: "00000000-0000-4000-8000-000000000001", email: "person@example.test" };
  return {
    success: true,
    sessionId: "00000000-0000-4000-8000-000000000004",
    expiresAt: "2099-01-01T00:00:00.000Z",
    idleExpiresAt: "2099-01-01T00:00:00.000Z",
    identity,
    sponsors: [],
    pendingIdentityCount: capacities.pendingIdentityCount ?? 0,
    actingIdentities: capacities.member
      ? [{ id: "00000000-0000-4000-8000-000000000003", organizationId: null, organizationName: null, jobTitle: null }]
      : [],
    actingIdentityId: capacities.member ? "00000000-0000-4000-8000-000000000003" : null,
    ...(capacities.staff
      ? {
          staff: {
            ...identity,
            scopes: [],
            grants: capacities.grants ?? (capacities.administrator === false ? [] : administratorGrants),
            expiresAt: "2026-08-26T00:00:00.000Z",
            idleExpiresAt: "2026-08-26T00:00:00.000Z",
          },
        }
      : {}),
    ...(capacities.member
      ? {
          member: {
            userId: identity.id,
            identityId: "00000000-0000-4000-8000-000000000003",
            email: identity.email,
            memberId: "00000000-0000-4000-8000-000000000002",
            organizationId: null,
            membershipCategory: "H5",
            isEcMember: false,
            activeIdentities: [
              {
                identityId: "00000000-0000-4000-8000-000000000003",
                memberId: "00000000-0000-4000-8000-000000000002",
                organizationId: null,
                organizationName: null,
                membershipCategory: "H5",
              },
            ],
          },
        }
      : {}),
  };
}
