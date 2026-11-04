import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { buildRegistrationIcs } from "../functions/_lib/utils/calendar";
import { registrationPortalPageUrl } from "../functions/_lib/services/frontend-links";

const event = {
  name: "Summit 2026",
  slug: "summit-2026",
  base_path: "/events/2026/summit/",
  starts_at: "2026-12-01T08:00:00.000Z",
  ends_at: "2026-12-02T17:00:00.000Z",
  settings_json: "{}",
  timezone: "UTC",
};

describe("registration calendar invites", () => {
  it("link the sign-in registration page, never the emailed management link, with two reminders", async () => {
    const registrationUrl = registrationPortalPageUrl("https://app.test", event, "registration-1");
    const calendar = await buildRegistrationIcs(event, "registration-1", registrationUrl, [
      { dayDate: "2026-12-01", attendanceType: "in_person", label: "Day 1" },
      { dayDate: "2026-12-02", attendanceType: "in_person", label: "Day 2" },
    ]);

    const parsed = new ICAL.Component(ICAL.parse(calendar.files[0]!.content));
    const events = parsed.getAllSubcomponents("vevent");
    expect(events).toHaveLength(2);
    for (const entry of events) {
      expect(entry.getFirstPropertyValue("url")).toBe(registrationUrl);
      expect(String(entry.getFirstPropertyValue("description"))).toContain(registrationUrl);
      expect(entry.getAllSubcomponents("valarm")).toHaveLength(2);
    }
    expect(registrationUrl).toBe("https://app.test/portal/#/events/summit-2026/registrations/registration-1");
  });
});
