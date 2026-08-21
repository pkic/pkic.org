import { describe, expect, it } from "vitest";
import {
  ADMIN_EVENT_REGISTRATION_STATUSES,
  adminEventCampaignPreviewSchema,
  adminManageDayAttendanceSchema,
  adminEventRegistrationStatusSchema,
  adminEventRegistrationsQuerySchema,
} from "../assets/shared/schemas/admin-events";
import {
  ADMIN_REGISTRATION_FORCE_STATUSES,
  adminRegistrationUpdateSchema,
} from "../assets/shared/schemas/route-contracts-admin-registrations";

describe("admin registration status policy", () => {
  it("uses the same statuses for listing and forced updates", () => {
    expect(ADMIN_REGISTRATION_FORCE_STATUSES).toBe(ADMIN_EVENT_REGISTRATION_STATUSES);

    for (const status of ADMIN_EVENT_REGISTRATION_STATUSES) {
      expect(adminEventRegistrationStatusSchema.parse(status)).toBe(status);
      expect(adminEventRegistrationsQuerySchema.parse({ status }).status).toBe(status);
      expect(adminRegistrationUpdateSchema.parse({ action: "force_status", status })).toEqual({
        action: "force_status",
        status,
      });
    }
  });

  it("does not conflate day-level waitlisting with registration status", () => {
    expect(adminEventRegistrationStatusSchema.safeParse("waitlisted").success).toBe(false);
    expect(adminRegistrationUpdateSchema.safeParse({ action: "force_status", status: "waitlisted" }).success).toBe(
      false,
    );
    expect(
      adminEventCampaignPreviewSchema.safeParse({
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
    expect(adminManageDayAttendanceSchema.parse({ action: "waitlist", dayDates: ["2026-12-01"] })).toEqual({
      action: "waitlist",
      dayDates: ["2026-12-01"],
    });
  });
});
