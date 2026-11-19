/**
 * The registration details block in every registration email reads plainly: each day says how
 * the person attends and adds a status only when the day is not simply confirmed, and a country
 * answer is named rather than shown as its code.
 */
import { describe, expect, it } from "vitest";
import { renderEmail } from "../functions/_lib/email/render";
import { buildAttendanceEmailData } from "../functions/_lib/utils/attendance";
import { formatCustomAnswerValue } from "../functions/_lib/utils/custom-answer-display";
import { DEFAULT_TEMPLATES } from "../scripts/seed-email-templates.mjs";

const detailsPartial = DEFAULT_TEMPLATES.find((template) => template.key === "partial_reg_details")!;

describe("registration details email", () => {
  it("shows a day's status only when the day is not simply confirmed", async () => {
    const { dayAttendance } = buildAttendanceEmailData(
      [
        { dayDate: "2026-12-01", attendanceType: "virtual", label: "Day 1", optionLabel: "Livestream Lounge" },
        { dayDate: "2026-12-02", attendanceType: "in_person", label: "Day 2" },
        { dayDate: "2026-12-03", attendanceType: "in_person", label: "Day 3" },
      ],
      [{ dayDate: "2026-12-03", status: "waiting" }],
    );
    const rendered = await renderEmail(
      "{{> reg_details}}",
      {
        dayAttendance,
        _partials: { reg_details: { content: detailsPartial.content, contentType: "markdown" } },
      },
      "{{{body_html}}}",
      "markdown",
    );
    expect(rendered.text).toMatch(/Day 1:\s*Livestream Lounge\s*\n/);
    expect(rendered.text).toMatch(/Day 2:\s*In person\s*\n/);
    expect(rendered.text).toMatch(/Day 3:\s*In person — waitlisted/);
  });

  it("names a country answer", () => {
    const field = { options: null, validation: { format: "iso_country" as const } };
    expect(formatCustomAnswerValue("NL", field)).toBe("Netherlands");
    expect(formatCustomAnswerValue("NL", { options: null })).toBe("NL");
  });
});
