/**
 * The participant page's event projection for frontend tests: a public event
 * the reader neither registered for nor scans at, parsed through the shared
 * audience contract so every variation stays a valid API response.
 */
import { eventAudienceDetailSchema } from "../../assets/shared/schemas/event-management";

export const participantEventId = "a0000000-0000-4000-8000-000000000001";
export const participantRegistrationId = "a0000000-0000-4000-8000-000000000002";

type EventOverrides = Partial<Parameters<typeof eventAudienceDetailSchema.parse>[0] & Record<string, unknown>>;

export function participantEventFixture(overrides: EventOverrides = {}) {
  return eventAudienceDetailSchema.parse({
    id: participantEventId,
    slug: "summit",
    name: "Summit",
    timezone: "Europe/Amsterdam",
    startsAt: null,
    endsAt: null,
    profileKey: null,
    registrationPolicy: "public",
    visibility: "public",
    accessLevel: "participant",
    location: "Amsterdam",
    links: [],
    basePath: "/events/summit/",
    sponsorLeadAccess: false,
    viewer: null,
    registrationPath: "/events/summit/register/",
    scannerAccess: { canScan: false, sponsors: [] },
    participation: { registrationId: null, registrationStatus: null, proposals: 0, speakerProposals: 0 },
    ...overrides,
  });
}

/** The overrides that make the reader a registered, in-person attendee. */
export const registeredParticipant = {
  viewer: { registrationStatus: "registered", attendanceType: "in_person", waitlisted: false, days: [] },
  participation: {
    registrationId: participantRegistrationId,
    registrationStatus: "registered",
    proposals: 0,
    speakerProposals: 0,
  },
};
