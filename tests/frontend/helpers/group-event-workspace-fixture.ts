import type { GroupEvent } from "../../../assets/shared/schemas/group-events";
export const GROUP_ID = "10000000-0000-4000-8000-000000000001";
export const EVENT_ID = "architecture-workshop";

export function groupEventWorkspaceFixture(overrides: Partial<GroupEvent> = {}): GroupEvent {
  return {
    id: EVENT_ID,
    ownerGroupId: GROUP_ID,
    seriesId: null,
    slug: EVENT_ID,
    basePath: `/events/2026/${EVENT_ID}/`,
    name: "Architecture workshop",
    timezone: "Europe/Amsterdam",
    startsAt: "2026-09-01T15:00:00.000Z",
    endsAt: "2026-09-01T16:00:00.000Z",
    profileKey: "workshop",
    sourceMode: "portal",
    registrationPolicy: "optional",
    visibility: "group_members",
    inviteLimitAttendee: 5,
    city: null,
    country: null,
    meetingLocation: null,
    links: [],
    nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    proposalAccess: null,
    capabilities: ["view"],
    ...overrides,
  };
}
