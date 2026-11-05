import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { buildRegistrationIcs } from "../functions/_lib/utils/calendar";
import { registrationManagePageUrl } from "../functions/_lib/services/frontend-links";

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
  it("preserve the emailed management link and all four standard reminders", async () => {
    const manageUrl = registrationManagePageUrl("https://app.test", event, "synthetic-manage-token");
    const calendar = await buildRegistrationIcs(event, "registration-1", manageUrl, [
      { dayDate: "2026-12-01", attendanceType: "in_person", label: "Day 1" },
      { dayDate: "2026-12-02", attendanceType: "in_person", label: "Day 2" },
    ]);

    const parsed = new ICAL.Component(ICAL.parse(calendar.files[0]!.content));
    const events = parsed.getAllSubcomponents("vevent");
    expect(events).toHaveLength(2);
    for (const entry of events) {
      expect(entry.getFirstPropertyValue("url")).toBe(manageUrl);
      expect(String(entry.getFirstPropertyValue("description"))).toContain(manageUrl);
      expect(
        entry.getAllSubcomponents("valarm").map((alarm) => String(alarm.getFirstPropertyValue("trigger"))),
      ).toEqual(["-PT24H", "-PT1H", "-PT15M", "-PT5M"]);
    }
    expect(manageUrl).toBe(
      "https://app.test/events/2026/summit/register/manage/?event=summit-2026&token=synthetic-manage-token",
    );
  });
});
