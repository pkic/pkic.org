import { describe, expect, it } from "vitest";
import {
  eventRegistrationExportsPath,
  eventRegistrationPath,
  eventRegistrationPromotionsPath,
  eventRegistrationResourcePath,
  eventRegistrationsPath,
  eventRegistrationsViewPath,
  eventRegistrationViewPath,
} from "../../assets/ts/admin/sections/events/detail/registration-paths";

describe("event registration resource paths", () => {
  it("builds one canonical encoded resource hierarchy", () => {
    expect(eventRegistrationsPath("PQC Europe/2026")).toBe("/api/v1/events/PQC%20Europe%2F2026/registrations");
    expect(eventRegistrationPath("event", "registration/1")).toBe(
      "/api/v1/events/event/registrations/registration%2F1",
    );
    expect(eventRegistrationExportsPath("event")).toBe("/api/v1/events/event/registrations/exports");
    expect(eventRegistrationPromotionsPath("event")).toBe("/api/v1/events/event/registrations/promotions");
    expect(eventRegistrationResourcePath("event", "registration", "audit")).toBe(
      "/api/v1/events/event/registrations/registration/audit",
    );
    expect(eventRegistrationsViewPath("event")).toBe("/events/event/registrations");
    expect(eventRegistrationViewPath("event", "registration")).toBe("/events/event/registrations/registration");
  });
});
