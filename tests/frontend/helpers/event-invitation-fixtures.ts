import type { EventAttendeeInviteSummary, EventInviteSummary } from "../../../assets/shared/schemas/event-invites";
import type { GroupEvent } from "../../../assets/shared/schemas/group-events";

export const GROUP_ID = "10000000-0000-4000-8000-000000000001";
export const EVENT_ID = "20000000-0000-4000-8000-000000000001";
export const INVITE_ID = "30000000-0000-4000-8000-000000000001";
export const EVENT: GroupEvent = {
  id: EVENT_ID,
  ownerGroupId: GROUP_ID,
  seriesId: null,
  slug: "working-group-event",
  basePath: null,
  name: "Working group event",
  timezone: "UTC",
  startsAt: "2026-12-01T08:00:00.000Z",
  endsAt: "2026-12-01T18:00:00.000Z",
  profileKey: "workshop",
  sourceMode: "portal",
  registrationPolicy: "public",
  visibility: "group_members",
  inviteLimitAttendee: 5,
  location: null,
  links: [],
  nextOccurrenceAt: null,
  updatedAt: "2026-08-01T12:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view", "manage"],
};

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function response(invites: EventAttendeeInviteSummary[] = [invite()]): {
  invites: EventAttendeeInviteSummary[];
  page: object;
} {
  return {
    invites,
    page: { limit: 50, offset: 0, total: invites.length, hasMore: false },
  };
}

export function invite(overrides: Partial<EventAttendeeInviteSummary> = {}): EventAttendeeInviteSummary {
  return {
    id: INVITE_ID,
    inviteeEmail: "invitee@example.test",
    inviteeFirstName: "Ada",
    inviteeLastName: "Lovelace",
    inviteType: "attendee",
    status: "sent",
    expiresAt: "2026-09-01T12:00:00.000Z",
    acceptedAt: null,
    declinedAt: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    actions: { resend: true, revoke: true },
    ...overrides,
  };
}

export function speakerInvite(overrides: Partial<EventInviteSummary> = {}): EventInviteSummary {
  return {
    id: INVITE_ID,
    inviteeEmail: "speaker@example.test",
    inviteeFirstName: "Ada",
    inviteeLastName: "Lovelace",
    inviteType: "speaker",
    status: "sent",
    declineReasonCode: null,
    declineReasonNote: null,
    unsubscribeFuture: 0,
    reminderCount: 0,
    sourceType: "staff",
    expiresAt: "2026-09-01T12:00:00.000Z",
    acceptedAt: null,
    declinedAt: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    inviterUserId: null,
    inviterEmail: null,
    inviterFirstName: null,
    inviterLastName: null,
    actions: { resend: true, revoke: true },
    ...overrides,
  };
}
