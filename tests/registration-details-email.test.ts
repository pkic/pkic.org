/**
 * The registration details block in every registration email reads plainly: each day says how
 * the person attends, every in-person day says whether it is confirmed, a waitlisted day warns
 * that it gives no venue entry, and a country answer is named rather than shown as its code.
 */
import { describe, expect, it } from "vitest";
import { renderEmail } from "../functions/_lib/email/render";
import { buildAttendanceEmailData, hasActiveDayWaitlist } from "../functions/_lib/utils/attendance";
import { formatCustomAnswerValue } from "../functions/_lib/utils/custom-answer-display";
import { DEFAULT_TEMPLATES } from "../scripts/seed-email-templates.mjs";

const detailsPartial = DEFAULT_TEMPLATES.find((template) => template.key === "partial_reg_details")!;

describe("registration details email", () => {
  it("says whether each in-person day is confirmed and warns that a waitlisted day gives no venue entry", async () => {
    const dayWaitlist = [{ dayDate: "2026-12-03", status: "waiting" }];
    const { dayAttendance } = buildAttendanceEmailData(
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
      ],
      dayWaitlist,
    );
    const rendered = await renderEmail(
      "{{> reg_details}}",
      {
        dayAttendance,
        hasActiveDayWaitlist: hasActiveDayWaitlist(dayWaitlist),
        _partials: { reg_details: { content: detailsPartial.content, contentType: "markdown" } },
      },
      "{{{body_html}}}",
      "markdown",
    );
    expect(rendered.text).toMatch(/Day 1:\s*Livestream Lounge\s*\n/);
    expect(rendered.text).toMatch(/Day 2:\s*In person — confirmed\s*\n/);
    expect(rendered.text).toMatch(/Day 3:\s*In person — waitlisted/);
    expect(rendered.text).toMatch(/Day 4:\s*Workshop room — confirmed/);
    expect(rendered.text).toContain("You can't enter the venue on a waitlisted day.");
  });

  it("names a country answer", () => {
    const field = { options: null, validation: { format: "iso_country" as const } };
    expect(formatCustomAnswerValue("NL", field)).toBe("Netherlands");
    expect(formatCustomAnswerValue("NL", { options: null })).toBe("NL");
  });
});
