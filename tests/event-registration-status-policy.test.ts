import { describe, expect, it } from "vitest";
import { eventEmailCampaignPreviewInputSchema } from "../assets/shared/schemas/event-email-campaigns";
import {
  EVENT_REGISTRATION_STATUSES,
  eventRegistrationStatusSchema,
  eventRegistrationsQuerySchema,
} from "../assets/shared/schemas/event-registrations";
import { eventRegistrationDayAttendanceChangeSchema } from "../assets/shared/schemas/event-registration-detail";
import { eventRegistrationManagementUpdateSchema } from "../assets/shared/schemas/route-contracts-event-registration-management";
import {
  attendeeRegistrationParticipationSchema,
  registrationCreateForTermsSchema,
  registrationManageSchema,
} from "../assets/shared/schemas/registration";

describe("event registration status policy", () => {
  it("allows no consents when an event has no terms, including the participation step", () => {
    const participation = { dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }], consents: [] };
    expect(attendeeRegistrationParticipationSchema.safeParse(participation).success).toBe(true);
    expect(
      registrationCreateForTermsSchema([]).safeParse({
        ...participation,
        firstName: "Ada",
        lastName: "Example",
        email: "ada@example.test",
      }).success,
    ).toBe(true);
    expect(registrationManageSchema.safeParse({ action: "update", firstName: "Ada" }).success).toBe(true);
  });

  it("requires only the event's live required terms at their current versions", () => {
    const term = { termKey: "privacy", version: "v2", required: true, contentRef: null, displayText: "Privacy policy" };
    const body = {
      firstName: "Ada",
      lastName: "Example",
      email: "ada@example.test",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      consents: [],
    };
    expect(registrationCreateForTermsSchema([{ ...term, required: false }]).safeParse(body).success).toBe(true);
    const contract = registrationCreateForTermsSchema([term]);
    for (const consents of [[], [{ termKey: term.termKey, version: "v1" }]]) {
      const result = contract.safeParse({ ...body, consents });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(["consents", "privacy"]);
    }
    expect(contract.safeParse({ ...body, consents: [{ termKey: term.termKey, version: term.version }] }).success).toBe(
      true,
    );
  });

  it("keeps lifecycle statuses available for filtering without exposing a generic force-status mutation", () => {
    for (const status of EVENT_REGISTRATION_STATUSES) {
      expect(eventRegistrationStatusSchema.parse(status)).toBe(status);
      expect(eventRegistrationsQuerySchema.parse({ status }).status).toBe(status);
      expect(eventRegistrationManagementUpdateSchema.safeParse({ action: "force_status", status }).success).toBe(false);
    }
  });

  it("does not conflate day-level waitlisting with registration status", () => {
    expect(eventRegistrationStatusSchema.safeParse("waitlisted").success).toBe(false);
    expect(
      eventRegistrationManagementUpdateSchema.safeParse({ action: "force_status", status: "waitlisted" }).success,
    ).toBe(false);
    expect(
      eventEmailCampaignPreviewInputSchema.safeParse({
        subjectOverride: "Waitlist update",
        bodyContent: "Update",
        sendMode: "personal",
        batchSize: 50,
        filter: {
          audience: "attendees",
          attendeeStatus: "registered",
          dayWaitlistStatus: "waiting",
        },
      }).success,
    ).toBe(true);
    expect(eventRegistrationDayAttendanceChangeSchema.parse({ action: "waitlist", dayDates: ["2026-12-01"] })).toEqual({
      action: "waitlist",
      dayDates: ["2026-12-01"],
    });
  });
});
