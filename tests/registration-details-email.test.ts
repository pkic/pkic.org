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

  it("never calls a day confirmed while the ticket is unpaid, and says what is owed", async () => {
    const data = buildAttendanceEmailData(
      [
        { dayDate: "2026-12-01", attendanceType: "virtual", label: "Day 1" },
        { dayDate: "2026-12-02", attendanceType: "in_person", label: "Day 2" },
        { dayDate: "2026-12-03", attendanceType: "in_person", label: "Day 3" },
      ],
      [{ dayDate: "2026-12-03", status: "waiting" }],
      "payment_required",
    );
    const rendered = await renderDetails({
      dayAttendance: data.dayAttendance,
      ...data.venueDayStanding,
      paymentDue: true,
      ticketPrice: "$395.00",
      paymentUrl: "https://example.test/portal/#/events/example/ticket",
    });
    expect(rendered.text).toMatch(/Payment:\s*\$395\.00 to pay/);
    expect(rendered.html).toContain("https://example.test/portal/#/events/example/ticket");
    expect(rendered.text).toMatch(/Day 2:\s*In person — awaiting payment/);
    expect(rendered.text).toMatch(/Day 3:\s*In person — waitlisted/);
    expect(rendered.text).not.toMatch(/— confirmed/);
    // The seat notice still explains the waiting day, and only that.
    expect(data.venueDayStanding).toMatchObject({ hasUnconfirmedVenueDay: true, hasWaitingVenueDay: true });
  });

  it("shows a cancelled registration's days as cancelled, with no seat notice", async () => {
    const data = buildAttendanceEmailData(
      [
        { dayDate: "2026-12-01", attendanceType: "virtual", label: "Day 1" },
        { dayDate: "2026-12-02", attendanceType: "in_person", label: "Day 2" },
      ],
      [{ dayDate: "2026-12-02", status: "waiting" }],
      "cancelled",
    );
    const rendered = await renderDetails({ dayAttendance: data.dayAttendance, ...data.venueDayStanding });
    expect(rendered.text).toMatch(/Day 1:\s*Virtual \(online\) — cancelled/);
    expect(rendered.text).toMatch(/Day 2:\s*In person — cancelled/);
    expect(rendered.text).not.toMatch(/confirmed|waitlisted|venue entry/);
  });

  it("opens the update email with the cancellation or the payment still owed", async () => {
    const updated = DEFAULT_TEMPLATES.find((template) => template.key === "registration_updated")!;
    const render = async (data: Record<string, unknown>) => ({
      subject: (await renderEmail(updated.subjectTemplate!, data, "{{{body_html}}}", "markdown")).text.trim(),
      body: (
        await renderEmail(
          updated.content,
          {
            eventName: "Example Event",
            ...data,
            _partials: {
              greeting: { content: "Hello,", contentType: "markdown" },
              reg_details: { content: detailsPartial.content, contentType: "markdown" },
              sponsors_block: { content: "", contentType: "html" },
              budget_waitlist_notice: { content: "", contentType: "markdown" },
            },
          },
          "{{{body_html}}}",
          "markdown",
        )
      ).text,
    });
    const cancelled = await render({ eventName: "Example Event", status: "cancelled" });
    expect(cancelled.subject).toBe("Your registration is cancelled — Example Event");
    expect(cancelled.body).not.toContain("was updated");
    expect(cancelled.body.indexOf("is cancelled")).toBeLessThan(cancelled.body.indexOf("Your registration details"));
    const unpaid = await render({
      eventName: "Example Event",
      status: "registered",
      paymentDue: true,
      payNow: true,
      ticketPrice: "$395.00",
      paymentUrl: "https://example.test/portal/#/events/example/ticket",
    });
    expect(unpaid.subject).toBe("Pay for your ticket to complete your registration — Example Event");
    expect(unpaid.body).toContain("You're not registered until your ticket is paid.");
    expect(unpaid.body).toContain("$395.00 is still to pay");
    // A payment that takes days is on its way: the email says so and asks for nothing.
    const processing = await render({
      eventName: "Example Event",
      status: "registered",
      paymentDue: true,
      paymentProcessing: true,
      ticketPrice: "$395.00",
    });
    expect(processing.subject).toBe("Your registration was updated — Example Event");
    expect(processing.body).toContain("Your payment of $395.00 is being processed.");
    expect(processing.body).toMatch(/Payment:\s*\$395\.00, being processed/);
    expect(processing.body).not.toContain("Pay for your ticket");
  });

  it("names a country answer", () => {
    const field = { options: null, validation: { format: "iso_country" as const } };
    expect(formatCustomAnswerValue("NL", field)).toBe("Netherlands");
    expect(formatCustomAnswerValue("NL", { options: null })).toBe("NL");
  });
});
