import { describe, expect, it } from "vitest";
import {
  applyTicketCode,
  currentTicketPricePeriod,
  decideClassifiedTicket,
  nextTicketPricePeriod,
  quoteTicket,
  ticketClassifierCriteria,
  type TicketPriceRule,
} from "../assets/shared/event-tickets";
import { eventTicketPricesReplaceSchema } from "../assets/shared/schemas/event-tickets";
import {
  formatTicketAmount,
  parseTicketAmount,
  ticketPeriodLabels,
  ticketRefundNote,
} from "../assets/shared/event-ticket-display";

const periods = [
  { id: "open", startsOn: null },
  { id: "spring", startsOn: "2027-03-20" },
  { id: "summer", startsOn: "2027-07-31" },
];
const TICKET = "00000000-0000-4000-8000-000000000001";

describe("ticket price periods", () => {
  it("starts a change at midnight in the event's zone, not in UTC", () => {
    // 22:30 UTC on March 19 is still March 19 in Amsterdam; half an hour later it is March 20 there.
    expect(currentTicketPricePeriod(periods, "2027-03-19T22:30:00.000Z", "Europe/Amsterdam")?.id).toBe("open");
    expect(currentTicketPricePeriod(periods, "2027-03-19T23:00:00.000Z", "Europe/Amsterdam")?.id).toBe("spring");
    expect(currentTicketPricePeriod(periods, "2027-03-19T23:30:00.000Z", "Europe/Amsterdam")?.id).toBe("spring");
  });

  it("names the change that follows the current one", () => {
    expect(nextTicketPricePeriod(periods, periods[0])?.id).toBe("spring");
    expect(nextTicketPricePeriod(periods, periods[2])).toBeNull();
  });
});

describe("ticket quotes", () => {
  const prices: TicketPriceRule[] = [
    {
      id: "all",
      ticketTypeId: TICKET,
      attendanceValue: "in_person",
      dayDate: null,
      charged: "once",
      amounts: { open: 19500 },
    },
    {
      id: "social",
      ticketTypeId: TICKET,
      attendanceValue: "in_person",
      dayDate: "2027-11-17",
      charged: "each_day",
      amounts: { open: 5000 },
    },
    {
      id: "workshop",
      ticketTypeId: TICKET,
      attendanceValue: "workshop",
      dayDate: null,
      charged: "each_day",
      amounts: { open: 10000 },
    },
  ];
  const quote = (dayAttendance: Array<{ dayDate: string; attendanceType: string }>) =>
    quoteTicket({ ticketTypeId: TICKET, periodId: "open", prices, dayAttendance });

  it("charges an all-days price once and a single-day price in place of it on that day", () => {
    const result = quote([
      { dayDate: "2027-11-16", attendanceType: "in_person" },
      { dayDate: "2027-11-17", attendanceType: "in_person" },
      { dayDate: "2027-11-18", attendanceType: "in_person" },
    ]);
    expect(result.total).toBe(19500 + 5000);
    expect(result.lines.find((line) => line.priceId === "all")?.dayDates).toEqual(["2027-11-16", "2027-11-18"]);
  });

  it("charges a per-day price for each day and nothing for an unpriced way of attending", () => {
    expect(
      quote([
        { dayDate: "2027-11-16", attendanceType: "workshop" },
        { dayDate: "2027-11-17", attendanceType: "workshop" },
        { dayDate: "2027-11-18", attendanceType: "virtual" },
      ]).total,
    ).toBe(20000);
  });

  it("charges only the highest event price when ways of attending are mixed, and still adds prices per day", () => {
    const mixed = quoteTicket({
      ticketTypeId: TICKET,
      periodId: "open",
      prices: [
        ...prices,
        {
          id: "lounge",
          ticketTypeId: TICKET,
          attendanceValue: "lounge",
          dayDate: null,
          charged: "once",
          amounts: { open: 9500 },
        },
      ],
      dayAttendance: [
        { dayDate: "2027-11-16", attendanceType: "lounge" },
        { dayDate: "2027-11-17", attendanceType: "workshop" },
        { dayDate: "2027-11-18", attendanceType: "in_person" },
      ],
    });
    expect(mixed.total).toBe(19500 + 10000);
    expect(mixed.lines.map((line) => [line.priceId, line.amount, line.included])).toEqual([
      ["lounge", 0, true],
      ["workshop", 10000, false],
      ["all", 19500, false],
    ]);
  });

  it("applies a code as a fixed price or a percentage off", () => {
    expect(applyTicketCode(39500, { amount: 0, percentOff: null })).toBe(0);
    expect(applyTicketCode(39500, { amount: null, percentOff: 25 })).toBe(29625);
    expect(applyTicketCode(999, { amount: null, percentOff: 33 })).toBe(670);
  });
});

describe("ticket classifier decisions", () => {
  const options = [
    { key: "pqcc_attendee", description: "Uses cryptography.", threshold: 0.85 },
    { key: "pqcc_vendor", description: "Sells  cryptography.", threshold: 0.9 },
  ];

  it("decides only at the chosen ticket's own certainty", () => {
    expect(decideClassifiedTicket(options, { pqcc_vendor: 0.89, pqcc_attendee: 0.11 })).toBeNull();
    expect(decideClassifiedTicket(options, { pqcc_vendor: 0.1, pqcc_attendee: 0.9 })?.key).toBe("pqcc_attendee");
    expect(decideClassifiedTicket(options, {})).toBeNull();
  });

  it("identifies a question by its keys and descriptions, whatever their order or spacing", () => {
    const same = [
      { key: "pqcc_vendor", description: "Sells cryptography.", threshold: 0.5 },
      { key: "pqcc_attendee", description: "Uses cryptography.", threshold: 0.5 },
    ];
    expect(ticketClassifierCriteria(same)).toBe(ticketClassifierCriteria(options));
    expect(ticketClassifierCriteria([{ ...options[0], key: "pki_attendee" }, options[1]])).not.toBe(
      ticketClassifierCriteria(options),
    );
  });
});

describe("ticket price contract and display", () => {
  it("requires one opening price, distinct dates and distinct rows", () => {
    const row = {
      id: "a",
      ticketTypeId: TICKET,
      attendanceValue: "in_person",
      dayDate: null,
      charged: "once",
      amounts: {},
    };
    const parse = (body: object) =>
      eventTicketPricesReplaceSchema.safeParse({ expectedRevision: 0, prices: [], ...body });
    expect(parse({ periods: [{ id: "a", startsOn: "2027-03-20" }] }).success).toBe(false);
    expect(
      parse({
        periods: [
          { id: "o", startsOn: null },
          { id: "a", startsOn: "2027-03-20" },
          { id: "b", startsOn: "2027-03-20" },
        ],
      }).success,
    ).toBe(false);
    expect(parse({ periods: [{ id: "o", startsOn: null }], prices: [row, { ...row, id: "b" }] }).success).toBe(false);
    expect(parse({ periods: [{ id: "o", startsOn: null }], prices: [row] }).success).toBe(true);
  });

  it("reads an organizer's amount in the currency's smallest unit", () => {
    expect(parseTicketAmount("195", "usd")).toBe(19500);
    expect(parseTicketAmount("195.50", "usd")).toBe(19550);
    expect(parseTicketAmount("", "usd")).toBe(0);
    expect(parseTicketAmount("abc", "usd")).toBeNull();
    expect(formatTicketAmount(0, "usd")).toBe("Free");
    expect(ticketPeriodLabels(periods)[0]).toMatchObject({ label: "Opening price" });
    expect(ticketPeriodLabels(periods)[2].until).toBeNull();
  });
});

describe("the refund policy as a registrant reads it", () => {
  const now = Date.parse("2027-01-10T12:00:00.000Z");
  it("says there are no refunds, that the period has ended, or until when", () => {
    expect(ticketRefundNote(null, "Europe/Amsterdam", now)).toBe("Tickets for this event are not refunded.");
    expect(ticketRefundNote("2027-01-01T08:00:00.000Z", "Europe/Amsterdam", now)).toBe(
      "The refund period for this event has ended.",
    );
    expect(ticketRefundNote("2027-02-01T08:00:00.000Z", "Europe/Amsterdam", now)).toMatch(
      /^You get your money back if you cancel before .+, and the difference if you move to days that cost less\.$/,
    );
  });
});
