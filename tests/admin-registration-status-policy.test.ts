import { describe, expect, it } from "vitest";
import { eventEmailCampaignPreviewInputSchema } from "../assets/shared/schemas/event-email-campaigns";
import {
  EVENT_REGISTRATION_STATUSES,
  eventRegistrationStatusSchema,
  eventRegistrationsQuerySchema,
} from "../assets/shared/schemas/event-registrations";
import { eventRegistrationDayAttendanceChangeSchema } from "../assets/shared/schemas/event-registration-detail";
import {
  ADMIN_REGISTRATION_FORCE_STATUSES,
  adminRegistrationUpdateSchema,
} from "../assets/shared/schemas/route-contracts-admin-registrations";

describe("admin registration status policy", () => {
  it("uses the same statuses for listing and forced updates", () => {
    expect(ADMIN_REGISTRATION_FORCE_STATUSES).toBe(EVENT_REGISTRATION_STATUSES);

    for (const status of EVENT_REGISTRATION_STATUSES) {
      expect(eventRegistrationStatusSchema.parse(status)).toBe(status);
      expect(eventRegistrationsQuerySchema.parse({ status }).status).toBe(status);
      expect(adminRegistrationUpdateSchema.parse({ action: "force_status", status })).toEqual({
        action: "force_status",
        status,
      });
    }
  });

  it("does not conflate day-level waitlisting with registration status", () => {
    expect(eventRegistrationStatusSchema.safeParse("waitlisted").success).toBe(false);
    expect(adminRegistrationUpdateSchema.safeParse({ action: "force_status", status: "waitlisted" }).success).toBe(
      false,
    );
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
