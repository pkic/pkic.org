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
    event: EVENT,
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
          { value: "in_person", label: "In person" },
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
