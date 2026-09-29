import { describe, expect, it } from "vitest";
import { eventEmailCampaignPreviewInputSchema } from "../assets/shared/schemas/event-email-campaigns";
import {
  EVENT_REGISTRATION_STATUSES,
  eventRegistrationStatusSchema,
  eventRegistrationsQuerySchema,
} from "../assets/shared/schemas/event-registrations";
import { eventRegistrationDayAttendanceChangeSchema } from "../assets/shared/schemas/event-registration-detail";
import { eventRegistrationManagementUpdateSchema } from "../assets/shared/schemas/route-contracts-event-registration-management";

describe("event registration status policy", () => {
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
