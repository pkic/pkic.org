/** A management-shaped row, as returned to a caller holding live event read permission. */
export function managementEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "pqc-2026",
    name: "PQC Conference 2026",
    timezone: "UTC",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T17:00:00.000Z",
    profileKey: null,
    sourceMode: null,
    registrationPolicy: "public",
    visibility: "public",
    inviteLimitAttendee: 5,
    city: null,
    country: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ownerGroupId: null,
    ownerGroupName: null,
    sourcePath: null,
    basePath: null,
    totalRegistrations: 0,
    confirmedRegistrations: 0,
    pendingInvites: 0,
    ...overrides,
  };
}

/** An audience-shaped row, as returned to every other caller. */
export function audienceEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000000002",
    slug: "pqc-2026",
    name: "PQC Conference 2026",
    timezone: "UTC",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T17:00:00.000Z",
    profileKey: null,
    registrationPolicy: "public",
    visibility: "public",
    accessLevel: "public",
    sponsorLeadAccess: false,
    city: null,
    country: null,
    links: [],
    basePath: "/events/pqc-2026",
    viewer: null,
    ...overrides,
  };
}
