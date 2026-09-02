import type { GroupEventSeries } from "../../../assets/shared/schemas/event-series";

/** A group-context meeting series as the list and the record page receive it. */
export function groupEventSeriesFixture(groupId: string, overrides: Partial<GroupEventSeries> = {}): GroupEventSeries {
  return {
    id: "60000000-0000-4000-8000-000000000005",
    eventId: "70000000-0000-4000-8000-000000000005",
    ownerGroupId: groupId,
    eventName: "Architecture call",
    eventSlug: "architecture-call",
    profileKey: "meeting",
    registrationPolicy: "no_registration",
    visibility: "group_members",
    memberEligibility: "owner_group",
    guestPolicy: "occurrence_invitation",
    startsAt: "2026-09-01T15:00:00.000Z",
    recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
    timezone: "Europe/Amsterdam",
    durationMinutes: 60,
    location: "Online",
    providerType: null,
    providerConfigured: false,
    active: true,
    inviteWindow: { startsAt: null, endsAt: null, timezone: "Europe/Amsterdam" },
    nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    capabilities: ["view", "manage"],
    occurrenceCount: 0,
    ...overrides,
  };
}
