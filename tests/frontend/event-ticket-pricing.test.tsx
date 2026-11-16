// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { eventDayReadModelSchema } from "../../assets/shared/schemas/event-read-models";
import {
  eventTicketOfferSchema,
  eventTicketQuoteRequestSchema,
  eventTicketQuoteSchema,
} from "../../assets/shared/schemas/event-tickets";
import { DayAttendancePicker } from "../../assets/ts/components/DayAttendancePicker";
import { EventTicketPricing } from "../../assets/ts/components/events/tickets/EventTicketPricing";

const days = [
  eventDayReadModelSchema.parse({
    dayDate: "2027-11-16",
    label: "Day one",
    inPersonCapacity: null,
    sortOrder: 1,
    attendanceOptions: [
      { value: "in_person", label: "In person" },
      { value: "virtual", label: "Virtual" },
    ],
  }),
];

const ticket = (key: string, name: string, amount: number, nextAmount: number) => ({
  key,
  name,
  descriptionMarkdown: `For **${name.toLowerCase()}** organizations.`,
  selectable: true,
  prices: [{ attendanceValue: "in_person", dayDate: null, charged: "once", amount, nextAmount }],
});

function offer(assigned: { ticketKey: string; source: string; organizationName: string | null } | null) {
  return eventTicketOfferSchema.parse({
    enabled: true,
    currency: "usd",
    timeZone: "Europe/Amsterdam",
    assigned,
    currentPeriodStartsOn: null,
    nextPeriodStartsOn: "2027-03-20",
    ticketIntro: "Choose based on your organization, not your job title.",
    tickets: [ticket("pqcc_attendee", "Attendee", 0, 19500), ticket("pqcc_vendor", "Vendor", 39500, 49500)],
  });
}

const PERSONAL_IDENTITY = "00000000-0000-4000-8000-0000000000aa";
let host: HTMLDivElement;
const requests: unknown[] = [];

type Offered = ReturnType<typeof offer>;
/** A test's own change to the offer the server gives. */
let reshape: (offered: Offered) => Offered = (offered) => offered;
/** The lines the quote answers with; a test sets them to a price another one covers. */
let quoteLines: Array<Record<string, unknown>> = [];

async function mount(assigned: Parameters<typeof offer>[0], identityId = "") {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/tickets/offer")) {
        const offered = reshape(offer(assigned));
        if (!String(url).includes(PERSONAL_IDENTITY)) return Response.json(offered);
        // A personal address: the ticket that is free for work addresses states what it costs here.
        const tickets = offered.tickets.map((entry) =>
          entry.key === "pqcc_attendee" ? { ...entry, personalEmailAmount: 19500 } : entry,
        );
        return Response.json({ ...offered, personalEmail: true, tickets });
      }
      const request = eventTicketQuoteRequestSchema.parse(JSON.parse(String(init?.body)));
      requests.push(request);
      if (request.code === "BAD")
        return Response.json(
          {
            error: { code: "TICKET_CODE_INVALID", message: "Refused", details: { fieldErrors: { code: ["Refused"] } } },
          },
          { status: 422 },
        );
      const vendor =
        request.ticketKey === "pqcc_vendor" || (!request.ticketKey && assigned?.ticketKey === "pqcc_vendor");
      const personal = request.identityId === PERSONAL_IDENTITY;
      const total = personal
        ? 19500
        : request.dayAttendance.some((choice) => choice.attendanceType === "in_person") && vendor
          ? 39500
          : 0;
      return Response.json(
        eventTicketQuoteSchema.parse({
          ticketKey: vendor ? "pqcc_vendor" : "pqcc_attendee",
          ticketName: vendor ? "Vendor" : "Attendee",
          source: request.disputeReason
            ? "disputed"
            : assigned
              ? "classifier"
              : request.ticketKey
                ? "chosen"
                : "default",
          currency: "usd",
          lines: quoteLines,
          subtotal: total,
          total,
          codeLabel: null,
          nextTotal: null,
          nextPeriodStartsOn: null,
          personalEmailPrice: personal,
        }),
      );
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      // As in the registration flow: the pricing hosts the form, and reads the identity from inside it.
      <EventTicketPricing slug="synthetic">
        <form>
          <input type="hidden" name="identityId" value={identityId} />
          <DayAttendancePicker days={days} />
        </form>
      </EventTicketPricing>,
      host,
    ),
  );
  await settle();
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 320));
  });

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
  reshape = (offered) => offered;
  quoteLines = [];
});

it("lets the person choose a ticket when none is decided and prices the days they pick", async () => {
  await mount(null);
  const radios = [...host.querySelectorAll<HTMLInputElement>('input[name="eventTicket"]')];
  expect(radios.map((radio) => radio.value)).toEqual(["pqcc_attendee", "pqcc_vendor"]);
  // Nothing is chosen for the person, and no price is asked for until they choose.
  expect(radios.some((radio) => radio.checked)).toBe(false);
  expect(requests).toHaveLength(0);
  expect(host.textContent).toContain("Choose based on your organization");
  expect(host.textContent).toContain("Amsterdam time");
  expect(host.textContent).toContain("Free");
  expect(host.textContent).toContain("$395");
  await act(() => radios[1].click());
  await act(() =>
    host.querySelector<HTMLInputElement>('input[name="dayAttendance.2027-11-16"][value="in_person"]')!.click(),
  );
  await settle();
  // Every quote is kept for the registration that follows, and carries the day choices.
  expect(requests.at(-1)).toMatchObject({
    ticketKey: "pqcc_vendor",
    save: true,
    dayAttendance: [{ dayDate: "2027-11-16", attendanceType: "in_person" }],
  });
  expect(host.querySelector(".pk-ticket-order__total")?.textContent).toContain("$395");
});

it("shows the decided ticket without a choice and asks for a reason before another ticket is sent", async () => {
  await mount({ ticketKey: "pqcc_vendor", source: "classifier", organizationName: "Example Cryptography Inc." });
  expect(host.querySelector('input[name="eventTicket"]')).toBeNull();
  expect(host.textContent).toContain("Example Cryptography Inc.");
  const dispute = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("isn't right"))!;
  await act(() => dispute.click());
  await act(() => host.querySelector<HTMLInputElement>('input[name="eventTicket"][value="pqcc_attendee"]')!.click());
  await settle();
  // Without a reason the other ticket is not requested: the decided one stays priced.
  expect(requests.at(-1)).not.toHaveProperty("ticketKey");
  const reason = host.querySelector<HTMLTextAreaElement>('textarea[name="disputeReason"]')!;
  await act(() => {
    reason.value = "We only buy these products.";
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  expect(requests.at(-1)).toMatchObject({ ticketKey: "pqcc_attendee", disputeReason: "We only buy these products." });
});

it("shows a refused code beside its field and keeps the person's ticket", async () => {
  await mount(null);
  await act(() => host.querySelector<HTMLInputElement>('input[name="eventTicket"][value="pqcc_attendee"]')!.click());
  await settle();
  const code = host.querySelector<HTMLInputElement>('input[name="code"]')!;
  await act(() => {
    code.value = "BAD";
    code.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Apply code")!.click());
  await settle();
  await settle();
  expect(code.getAttribute("aria-invalid")).toBe("true");
  expect(host.textContent).toContain("Refused");
  expect(requests.at(-1)).not.toHaveProperty("code");
});

it("prices the identity chosen on the first step and offers the way back to a work address", async () => {
  await mount(null, PERSONAL_IDENTITY);
  await act(() => host.querySelector<HTMLInputElement>('input[name="eventTicket"][value="pqcc_attendee"]')!.click());
  await settle();
  expect(requests.at(-1)).toMatchObject({ identityId: PERSONAL_IDENTITY });
  // The way to the free price is the flow's own identity step, not another sign-up.
  const back = host.querySelector<HTMLButtonElement>('button[data-step-jump="1"]');
  expect(back?.textContent).toContain("Use a work address");
});

it("states a range on the ticket and the exact price on each way of attending", async () => {
  reshape = (offered) => ({
    ...offered,
    tickets: offered.tickets.map((entry) => ({
      ...entry,
      prices: [...entry.prices, { ...entry.prices[0], attendanceValue: "virtual", amount: 0, nextAmount: 0 }],
    })),
  });
  await mount(null);
  const stubs = () => [...host.querySelectorAll(".pk-ticket__stub")].map((stub) => stub.textContent);
  // A row without a price keeps an empty band, so the prices stay one column; it says nothing.
  const notes = () =>
    [...host.querySelectorAll(".pk-attendance-matrix__price:not([aria-hidden])")].map((note) => note.textContent);
  // The ticket summarizes; nothing on it names a way of attending.
  expect(stubs()).toEqual(["Freeuntil Mar 19, 2027then up to $195", "Free to $395depends on how you attend"]);
  // Before a ticket is chosen each row says what it costs across the tickets.
  expect(notes()).toEqual(["Free to $395by ticket", "Free"]);
  await act(() => host.querySelector<HTMLInputElement>('input[name="eventTicket"][value="pqcc_vendor"]')!.click());
  await settle();
  // One day in this event, so the amount needs no words on what it covers.
  expect(notes()).toEqual(["$395", "Free"]);
});

it("says a way of attending is included when the higher event price covers it", async () => {
  reshape = (offered) => ({
    ...offered,
    tickets: offered.tickets.map((entry) => ({
      ...entry,
      prices: [...entry.prices, { ...entry.prices[0], attendanceValue: "virtual", amount: 5000, nextAmount: 5000 }],
    })),
  });
  quoteLines = [
    { attendanceValue: "in_person", dayDates: ["2027-11-16"], charged: "once", amount: 39500, included: false },
    { attendanceValue: "virtual", dayDates: ["2027-11-17"], charged: "once", amount: 0, included: true },
  ];
  await mount(null);
  await act(() => host.querySelector<HTMLInputElement>('input[name="eventTicket"][value="pqcc_vendor"]')!.click());
  await settle();
  const notes = [...host.querySelectorAll(".pk-attendance-matrix__price:not([aria-hidden])")].map(
    (note) => note.textContent,
  );
  expect(notes).toEqual(["$395", "Included"]);
});

it("counts a price set for one day in the range and on its row", async () => {
  reshape = (offered) => ({
    ...offered,
    nextPeriodStartsOn: null,
    tickets: [
      {
        ...offered.tickets[1],
        prices: [
          { attendanceValue: "in_person", dayDate: "2027-11-16", charged: "each_day", amount: 10000, nextAmount: null },
          { attendanceValue: "in_person", dayDate: null, charged: "each_day", amount: 15000, nextAmount: null },
        ],
      },
    ],
  });
  await mount(null);
  expect(host.querySelector(".pk-ticket__stub")?.textContent).toBe("$100 to $150depends on the days you attend");
  // A price per day sits on the day it is paid for; the row only says how it is charged.
  expect(host.querySelector(".pk-attendance-matrix__price")?.textContent).toBe("per day");
  expect(host.querySelector(".pk-attendance-matrix__day-price")?.textContent).toBe("$100");
});

it("adds nothing up below the grid when the event's only ticket costs nothing", async () => {
  reshape = (offered) => ({
    ...offered,
    nextPeriodStartsOn: null,
    tickets: [{ ...offered.tickets[0], prices: [{ ...offered.tickets[0].prices[0], nextAmount: null }] }],
  });
  await mount(null);
  expect(host.textContent).toContain("Free");
  expect(host.querySelector(".pk-ticket-order")).toBeNull();
  expect(host.querySelector('input[name="code"]')).toBeNull();
});
