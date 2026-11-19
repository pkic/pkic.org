/**
 * The registration details block in every registration email reads plainly: each day says how
 * the person attends, only a confirmed venue day says confirmed, any other venue day explains its
 * next step, and a country answer is named rather than shown as its code.
 */
import { describe, expect, it } from "vitest";
import { renderEmail } from "../functions/_lib/email/render";
import { buildAttendanceEmailData } from "../functions/_lib/utils/attendance";
import { formatCustomAnswerValue } from "../functions/_lib/utils/custom-answer-display";
import { DEFAULT_TEMPLATES } from "../scripts/seed-email-templates.mjs";

const detailsPartial = DEFAULT_TEMPLATES.find((template) => template.key === "partial_reg_details")!;

const renderDetails = (data: Record<string, unknown>) =>
  renderEmail(
    "{{> reg_details}}",
    { ...data, _partials: { reg_details: { content: detailsPartial.content, contentType: "markdown" } } },
    "{{{body_html}}}",
    "markdown",
  );

describe("registration details email", () => {
  it("marks only confirmed venue days as confirmed and explains each next step", async () => {
    const dayWaitlist = [
      { dayDate: "2026-12-03", status: "waiting" },
      { dayDate: "2026-12-05", status: "offered" },
      { dayDate: "2026-12-06", status: "expired" },
    ];
    const { dayAttendance, venueDayStanding } = buildAttendanceEmailData(
      [
        { dayDate: "2026-12-01", attendanceType: "virtual", label: "Day 1", optionLabel: "Livestream Lounge" },
        { dayDate: "2026-12-02", attendanceType: "in_person", label: "Day 2" },
        { dayDate: "2026-12-03", attendanceType: "in_person", label: "Day 3" },
        {
          dayDate: "2026-12-04",
          attendanceType: "workshop_room",
          label: "Day 4",
          optionLabel: "Workshop room",
          accessMode: "physical" as const,
        },
        { dayDate: "2026-12-05", attendanceType: "in_person", label: "Day 5" },
        { dayDate: "2026-12-06", attendanceType: "in_person", label: "Day 6" },
      ],
      dayWaitlist,
    );
    const rendered = await renderDetails({ dayAttendance, ...venueDayStanding });
    expect(rendered.text).toMatch(/Day 1:\s*Livestream Lounge\s*\n/);
    expect(rendered.text).toMatch(/Day 2:\s*In person — confirmed\s*\n/);
    expect(rendered.text).toMatch(/Day 3:\s*In person — waitlisted\s*\n/);
    expect(rendered.text).toMatch(/Day 4:\s*Workshop room — confirmed/);
    expect(rendered.text).toMatch(/Day 5:\s*In person — waitlisted, seat offered/);
    expect(rendered.text).toMatch(/Day 6:\s*In person — waitlisted, offer expired/);
    expect(rendered.text).not.toMatch(/not confirmed/);
    expect(rendered.text).toContain("Only days marked confirmed give you venue entry.");
    expect(rendered.text).toContain("Accept your offered seat before the offer expires");
    expect(rendered.text).toContain("update your registration to request a place again");
    expect(rendered.text).toContain("We'll email you if a seat opens up.");
  });

  it("shows no venue notice when every venue day is confirmed", async () => {
    const data = buildAttendanceEmailData(
      [{ dayDate: "2026-12-02", attendanceType: "in_person", label: "Day 2" }],
      [{ dayDate: "2026-12-02", status: "accepted" }],
    );
    expect(data.venueDayStanding.hasUnconfirmedVenueDay).toBe(false);
    expect((await renderDetails({ dayAttendance: data.dayAttendance, ...data.venueDayStanding })).text).not.toContain(
      "venue entry",
    );
  });

  it("names a country answer", () => {
    const field = { options: null, validation: { format: "iso_country" as const } };
    expect(formatCustomAnswerValue("NL", field)).toBe("Netherlands");
    expect(formatCustomAnswerValue("NL", { options: null })).toBe("NL");
  });
});
