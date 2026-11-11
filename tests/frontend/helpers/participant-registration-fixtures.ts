import { eventFormsResponseSchema } from "../../../assets/shared/schemas/forms";
import {
  registrationManageReadResponseSchema,
  type RegistrationManageReadResponse,
} from "../../../assets/shared/schemas/registration";

export const REGISTRATION_ID = "11111111-1111-4111-8111-111111111111";
export const ENDPOINT = `/api/v1/registrations/${REGISTRATION_ID}`;
export const EVENT = { id: "event-1", slug: "pqc-2026", name: "PQC Conference" };

export function readResponse(overrides: Partial<RegistrationManageReadResponse> = {}): RegistrationManageReadResponse {
  return registrationManageReadResponseSchema.parse({
    success: true,
    sponsorSharing: { allowed: false, withdrawnAt: null },
    registration: {
      id: REGISTRATION_ID,
      event_id: EVENT.id,
      status: "registered",
      cancellation_reason_code: null,
      attendance_type: "in_person",
      custom_answers: { dietary: "Vegetarian" },
      isEmailVerified: true,
    },
    identityId: null,
    event: { ...EVENT, startsAt: "2026-12-01T09:00:00.000Z" },
    user: {
      email: "ada@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      organization_name: "Analytical Engines",
      job_title: "Engineer",
    },
    eventDays: [
      {
        dayDate: "2026-12-01",
        label: "Day 1",
        inPersonCapacity: 10,
        sortOrder: 1,
        attendanceOptions: [
          { value: "in_person", label: "In person", spotsRemainingPercent: 100 },
          { value: "on_demand", label: "On demand" },
        ],
      },
    ],
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person", label: "Day 1" }],
    dayWaitlist: [],
    waitlistHandledLast: false,
    shareUrl: null,
    headshotUrl: null,
    ...overrides,
  });
}

export const FORMS = eventFormsResponseSchema.parse({
  event: EVENT,
  registrationPolicy: "optional",
  purpose: "event_registration",
  form: {
    id: "22222222-2222-4222-8222-222222222222",
    key: "registration",
    title: "Registration",
    description: null,
    fields: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        key: "dietary",
        label: "Dietary requirements",
        fieldType: "text",
        required: false,
        options: null,
        optionSource: null,
        validation: null,
        sortOrder: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
      },
    ],
  },
  requiredTerms: [],
  allowedSessionTypes: [],
  eventDays: [],
});

/** A signed-in registrant who holds a personal and an organization identity. */
export type SessionIdentity = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  jobTitle: string | null;
};
const OWNER_ID = "00000000-0000-4000-8000-000000000041";
export const PERSONAL: SessionIdentity = {
  id: "00000000-0000-4000-8000-000000000042",
  organizationId: null,
  organizationName: null,
  jobTitle: "Engineer",
};
export const WORK: SessionIdentity = {
  id: "00000000-0000-4000-8000-000000000043",
  organizationId: "00000000-0000-4000-8000-000000000044",
  organizationName: "Analytical Engines",
  jobTitle: "Engineer",
};

function ownerSession(identities: SessionIdentity[]) {
  return {
    success: true,
    sessionId: "00000000-0000-4000-8000-000000000045",
    expiresAt: "2099-12-31T23:59:59.000Z",
    idleExpiresAt: "2099-12-31T23:59:59.000Z",
    identity: { id: OWNER_ID, email: "ada@example.test" },
    eventParticipation: true,
    actingIdentityId: identities[0]!.id,
    actingIdentities: identities,
  };
}

function identityRecord(identity: SessionIdentity) {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    ...identity,
    memberId: null,
    membershipCategory: null,
    userId: OWNER_ID,
    userName: "Ada Lovelace",
    emailId: null,
    email: "ada@example.test",
    biography: null,
    links: [],
    headshotUrl: null,
    source: "verified_email",
    state: "active",
    showOnOrganizationProfile: true,
    invitedAt: now,
    startedAt: now,
    endedAt: null,
    blockedAt: null,
    blockedByUserId: null,
    predecessorIdentityId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** The registrant's session, identities, and representation change, or null for any other request. */
export function identityApi(method: string, path: string, identities: SessionIdentity[]): unknown {
  if (method === "GET" && path === "/api/v1/auth/session") return ownerSession(identities);
  if (method === "GET" && path === "/api/v1/users/current/identities")
    return {
      identities: identities.map(identityRecord),
      page: { limit: 25, offset: 0, total: identities.length, hasMore: false },
    };
  if (method === "PUT" && path === `${ENDPOINT}/identity`)
    return { success: true, identity: identities[1], badgeVersion: "2026-01-01T00:00:00.000Z" };
  return null;
}
