/**
 * Layouts for event tickets: the attendee's attendance step with a ticket and
 * its price, and the organizer's ticket settings. Static until approved.
 */
import type { PreviewSection } from "./PreviewShell";
import { TicketAwaitingPayment, TicketUnpaidStanding } from "./sections-event-ticket-payment";
import { TicketSalesPreview } from "./TicketSalesPreview";
import { DayAttendancePicker } from "../../components/DayAttendancePicker";
import { TicketCard, TicketChoice } from "../../components/events/tickets/TicketCard";
import {
  TicketPriceTable,
  type TicketPriceGroupView as TicketPriceGroup,
  type TicketPricePeriodColumn as TicketPricePeriod,
} from "../../components/events/tickets/TicketPriceTable";
import { formatZoneCity } from "../../../shared/format-date";
import { eventDayReadModelSchema } from "../../../shared/schemas/event-read-models";
import { Button } from "../Button";
import { DataTable } from "../DataTable";
import { DescriptionList } from "../DescriptionList";
import { Field } from "../Field";
import { InputGroup } from "../InputGroup";
import { IconClock, IconMapPin, IconVideo } from "../MediaIcons";
import { Menu } from "../Menu";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import { StatCard } from "../StatCard";
import { TextInput } from "../TextControl";

/** This sample event's own ways of attending; an event defines them, no shared vocabulary does. */
const WAYS_TO_ATTEND = {
  in_person: { label: "In person", description: "At the venue" },
  virtual: { label: "Virtual", description: "Live stream with Q&A" },
};
const DAYS = ["2027-11-16", "2027-11-17", "2027-11-18"].map((dayDate, index) =>
  eventDayReadModelSchema.parse({
    dayDate,
    label: `Day ${index + 1}`,
    inPersonCapacity: null,
    sortOrder: index,
    attendanceOptions: Object.entries(WAYS_TO_ATTEND).map(([value, way]) => ({ value, ...way })),
  }),
);
const ALL_IN_PERSON = Object.fromEntries(DAYS.map((day) => [day.dayDate, "in_person"]));

const ATTENDEE_COPY =
  "For people whose organization **uses or runs** PKI and cryptography for itself.\n\n- Banks, telecoms, manufacturers and healthcare\n- Government, universities and research\n- Standards bodies and non-profits";
const VENDOR_COPY =
  "For people whose organization **sells or provides** PKI, cryptography or quantum products or services.\n\n- Product and service vendors, resellers and integrators\n- Consulting and managed services";

function Order({
  lines,
  total,
  deadline,
  action,
}: {
  lines: ReadonlyArray<{ label: string; note?: string; amount: string }>;
  total: string;
  deadline?: string;
  action: string;
}) {
  return (
    <div class="pk-stack">
      <div class="pk-ticket-order">
        <dl class="pk-ticket-order__lines">
          {lines.map((line) => (
            <div class="pk-ticket-order__line" key={line.label}>
              <dt>
                {line.label}
                {line.note && <small>{line.note}</small>}
              </dt>
              <dd>{line.amount}</dd>
            </div>
          ))}
          <div class="pk-ticket-order__line pk-ticket-order__total">
            <dt>Total</dt>
            <dd>{total}</dd>
          </div>
        </dl>
        {deadline && (
          <p class="pk-ticket-order__deadline">
            <IconClock width="16" height="16" />
            {deadline}
          </p>
        )}
        <Field label="Sponsor or partner code" help="A sponsor or partner code sets your ticket type and price.">
          {(control) => (
            <InputGroup>
              <TextInput {...control} name="ticketCode" autocomplete="off" />
              <Button type="button">Apply code</Button>
            </InputGroup>
          )}
        </Field>
      </div>
      <div class="pk-cluster">
        <Button type="button">Back</Button>
        <Button type="button" variant="primary">
          {action}
        </Button>
      </div>
    </div>
  );
}

/** We could not tell which ticket applies, so the person chooses above the attendance grid. */
function AttendanceWithTicketChoice() {
  return (
    <Panel aria-label="Event registration">
      <PanelBody class="pk-stack pk-stack--loose">
        <TicketChoice
          legend="Choose your ticket"
          intro="Choose based on your organization, not your job title."
          footnote={`Prices hold until 11:59 pm ${formatZoneCity("Europe/Amsterdam")} time on Mar 19, 2027.`}
        >
          <TicketCard
            name="ticket"
            value="attendee"
            title="Attendee"
            description={ATTENDEE_COPY}
            note="Work email address required"
            price="Free"
            priceTerms="until Mar 19, 2027"
            priceNext="then up to $195"
          />
          <TicketCard
            name="ticket"
            value="vendor"
            title="Vendor"
            description={VENDOR_COPY}
            price="Free"
            priceTo="$395"
            priceNext="depends on how you attend"
          />
        </TicketChoice>
        <DayAttendancePicker
          days={DAYS}
          value={ALL_IN_PERSON}
          onChange={() => {}}
          priceHeading="Attendee ticket"
          optionPrices={{ in_person: { amount: "Free" }, virtual: { amount: "Free" } }}
        />
        <Order
          lines={[{ label: "Attendee ticket", note: "In person, Nov 16 to 18, 2027", amount: "Free" }]}
          total="Free"
          deadline="Register by Mar 19, 2027 to get this ticket free. New registrations from Mar 20, 2027 are $195."
          action="Continue"
        />
      </PanelBody>
    </Panel>
  );
}

/** The ticket is already known from the person's organization: no choice, the price leads. */
function AttendanceWithAssignedTicket() {
  return (
    <Panel aria-label="Event registration">
      <PanelBody class="pk-stack pk-stack--loose">
        <TicketCard
          title="Vendor"
          description={VENDOR_COPY}
          price="$395"
          priceTerms="until Mar 19, 2027"
          priceNext="then $495"
          reason={
            <>
              Based on your organization, <strong>Example Cryptography Inc.</strong> Not right? You can ask the
              organizers to review it after you register.
            </>
          }
        />
        <DayAttendancePicker
          days={DAYS}
          value={ALL_IN_PERSON}
          onChange={() => {}}
          priceHeading="Vendor ticket"
          optionPrices={{ in_person: { amount: "$395", per: "event" }, virtual: { amount: "Free" } }}
        />
        <Order
          lines={[{ label: "Vendor ticket", note: "In person, Nov 16 to 18, 2027", amount: "$395" }]}
          total="$395"
          deadline="Register by Mar 19, 2027 to pay $395. New registrations from Mar 20, 2027 are $495."
          action="Continue to payment"
        />
      </PanelBody>
    </Panel>
  );
}

const LOUNGE_DAYS = DAYS.map((day) =>
  eventDayReadModelSchema.parse({
    ...day,
    attendanceOptions: [
      { value: "in_person", label: "In person", description: "At the venue" },
      { value: "lounge", label: "Live stream lounge", description: "Watch together near the venue", icon: "coffee" },
      { value: "virtual", label: "Virtual", description: "Live stream with Q&A" },
    ],
  }),
);

/** Prices charged per day: a day with a price of its own states it where that day is chosen. */
function AttendanceWithDayPrices() {
  return (
    <Panel aria-label="Event registration">
      <PanelBody class="pk-stack pk-stack--loose">
        <TicketCard
          title="Vendor"
          description={VENDOR_COPY}
          price="Free"
          priceTo="$395"
          priceNext="depends on how and when you attend"
          reason={
            <>
              Based on your organization, <strong>Example Cryptography Inc.</strong>
            </>
          }
        />
        <DayAttendancePicker
          days={LOUNGE_DAYS}
          value={{ "2027-11-16": "in_person", "2027-11-17": "in_person", "2027-11-18": "lounge" }}
          onChange={() => {}}
          priceHeading="Vendor ticket"
          optionPrices={{
            in_person: { amount: "$395", per: "event" },
            lounge: { amount: "$50", per: "day", byDay: { "2027-11-18": "$75" } },
            virtual: { amount: "Free" },
          }}
        />
        <Order
          lines={[
            { label: "Vendor ticket", note: "In person, Nov 16 and 17, 2027", amount: "$395" },
            { label: "Vendor ticket", note: "Live stream lounge, Nov 18, 2027", amount: "$75" },
          ]}
          total="$470"
          action="Continue to payment"
        />
      </PanelBody>
    </Panel>
  );
}

const LONG_DAYS = Array.from({ length: 9 }, (_, index) =>
  eventDayReadModelSchema.parse({
    ...LOUNGE_DAYS[0],
    dayDate: `2027-11-${String(15 + index).padStart(2, "0")}`,
    label: `Day ${index + 1}`,
    sortOrder: index,
  }),
);

/** A schedule too long for a phone's rows: the days run down the page and keep their prices. */
function AttendanceWithLongSchedule() {
  return (
    <Panel aria-label="Event registration">
      <PanelBody class="pk-stack pk-stack--loose">
        <DayAttendancePicker
          days={LONG_DAYS}
          value={{ "2027-11-15": "in_person", "2027-11-16": "in_person", "2027-11-23": "lounge" }}
          onChange={() => {}}
          priceHeading="Vendor ticket"
          optionPrices={{
            in_person: { amount: "$395", per: "event" },
            lounge: { amount: "$50", per: "day", byDay: { "2027-11-23": "$75" } },
            virtual: { amount: "Free" },
          }}
        />
      </PanelBody>
    </Panel>
  );
}

/** An event where nothing costs money: the ticket says so and nothing is added up below the grid. */
function AttendanceWithFreeTicket() {
  return (
    <Panel aria-label="Event registration">
      <PanelBody class="pk-stack pk-stack--loose">
        <TicketCard title="Attendee" description={ATTENDEE_COPY} price="Free" />
        <DayAttendancePicker days={DAYS} value={ALL_IN_PERSON} onChange={() => {}} />
      </PanelBody>
    </Panel>
  );
}

/** A personal address on a ticket that is free for work addresses: the price, and the way to the free one. */
function AttendanceWithPersonalAddress() {
  return (
    <Panel aria-label="Event registration">
      <PanelBody class="pk-stack pk-stack--loose">
        <TicketCard
          title="Attendee"
          description={ATTENDEE_COPY}
          price="$195"
          priceTerms="with a personal address"
          note={
            <>
              Free with a work email address ·{" "}
              <Button type="button" variant="link">
                Use a work address
              </Button>
            </>
          }
        />
        <div class="pk-ticket-order">
          <dl class="pk-ticket-order__lines">
            <div class="pk-ticket-order__line">
              <dt>
                Attendee ticket
                <small>Price for a personal email address</small>
              </dt>
              <dd>$195</dd>
            </div>
            <div class="pk-ticket-order__line pk-ticket-order__total">
              <dt>Total</dt>
              <dd>$195</dd>
            </div>
          </dl>
          <p class="pk-ticket-order__switch">
            <strong>This ticket is free with a work email address.</strong> Go back one step to add your organization to
            your account, then register as its representative. You keep the same account.
          </p>
          <p class="pk-small pk-muted">
            You pay on the next page after you register. Your place is confirmed once the payment arrives. You get an
            invoice by email after payment.
          </p>
        </div>
      </PanelBody>
    </Panel>
  );
}

const PERIODS: TicketPricePeriod[] = [
  { id: "open", label: "Opening price", until: "until Mar 19, 2027", startsOn: null, current: true },
  { id: "p2", label: "From Mar 20", until: "until Jul 30", startsOn: "2027-03-20" },
  { id: "p3", label: "From Jul 31", until: "until Oct 29", startsOn: "2027-07-31" },
  { id: "p4", label: "From Oct 30", until: "and at the door", startsOn: "2027-10-30" },
];

const inPerson = <IconMapPin width="16" height="16" />;
const virtual = <IconVideo width="16" height="16" />;

const GROUPS: TicketPriceGroup[] = [
  {
    id: "attendee",
    ticket: "Attendee",
    summary: "Work email address required while free",
    rows: [
      {
        id: "a1",
        attendance: "In person",
        icon: inPerson,
        covers: "All days",
        charged: "once",
        prices: ["Free", "$195", "$295", "$395"],
      },
      {
        id: "a2",
        attendance: "Virtual",
        icon: virtual,
        covers: "All days",
        charged: "once",
        prices: ["Free", "Free", "Free", "Free"],
      },
    ],
  },
  {
    id: "vendor",
    ticket: "Vendor",
    rows: [
      {
        id: "v1",
        attendance: "In person",
        icon: inPerson,
        covers: "All days",
        charged: "once",
        prices: ["$395", "$495", "$595", "$695"],
      },
      {
        id: "v2",
        attendance: "Virtual",
        icon: virtual,
        covers: "All days",
        charged: "once",
        prices: ["Free", "Free", "Free", "Free"],
      },
    ],
  },
];

interface TicketTypeRow {
  id: string;
  name: string;
  summary: string;
  assigned: string;
  registered: string;
  paid: string;
}
const TICKET_TYPES: TicketTypeRow[] = [
  {
    id: "attendee",
    name: "Attendee",
    summary: "Organizations that use or run PKI and cryptography for themselves",
    assigned: "Default when unsure",
    registered: "412",
    paid: "0",
  },
  {
    id: "vendor",
    name: "Vendor",
    summary: "Organizations that sell or provide PKI, cryptography or quantum products or services",
    assigned: "37 organizations preset",
    registered: "38",
    paid: "33",
  },
];

interface CodeRow {
  id: string;
  label: string;
  ticket: string;
  price: string;
  used: string;
}
const CODES: CodeRow[] = [
  { id: "1", label: "Example Gold sponsor: staff", ticket: "Vendor", price: "Free", used: "1 of 4" },
  { id: "2", label: "Example Gold sponsor: customers", ticket: "Attendee", price: "Free", used: "0 of 8" },
  { id: "3", label: "Standards body partners", ticket: "Attendee", price: "$149", used: "12 of 50" },
];

function TicketSettings() {
  return (
    <div class="pk-stack">
      <div class="pk-stat-row">
        <StatCard label="Collected" value="$13,035" note="33 paid tickets" />
        <StatCard label="Awaiting payment" value="5" note="$1,975 open" tone="warn" />
        <StatCard label="Free tickets" value="412" note="Attendee, until Mar 19" />
        <StatCard label="Next price change" value="Mar 20" note="in 62 days" />
      </div>
      <Panel aria-label="Prices">
        <PanelHeader
          title="Prices"
          menu={<Menu label="Price actions" align="end" items={[{ id: "edit", label: "Edit prices" }]} />}
        />
        <PanelBody flush>
          <TicketPriceTable periods={PERIODS} groups={GROUPS} />
        </PanelBody>
        <PanelBody>
          <p class="pk-small pk-muted">
            Prices are in US dollars. Each change starts at midnight in Amsterdam (Europe/Amsterdam).
          </p>
        </PanelBody>
      </Panel>
      <Panel aria-label="Tickets">
        <PanelHeader title="Tickets">
          <Button type="button" variant="primary">
            Add ticket
          </Button>
        </PanelHeader>
        <PanelBody flush>
          <DataTable<TicketTypeRow>
            caption="Tickets"
            rows={TICKET_TYPES}
            rowKey={(row) => row.id}
            columns={[
              {
                id: "name",
                header: "Ticket",
                cell: (row) => (
                  <>
                    <strong>{row.name}</strong>
                    <div class="pk-small pk-muted">{row.summary}</div>
                  </>
                ),
              },
              { id: "assigned", header: "Given to", width: "fit", cell: (row) => row.assigned },
              { id: "registered", header: "Registered", width: "fit", align: "end", cell: (row) => row.registered },
              { id: "paid", header: "Paid", width: "fit", align: "end", cell: (row) => row.paid },
            ]}
          />
        </PanelBody>
      </Panel>
      <Panel aria-label="Codes">
        <PanelHeader title="Codes">
          <Button type="button" variant="primary">
            Create code
          </Button>
        </PanelHeader>
        <PanelBody flush>
          <DataTable<CodeRow>
            caption="Codes"
            rows={CODES}
            rowKey={(row) => row.id}
            columns={[
              { id: "label", header: "Code for", cell: (row) => row.label },
              { id: "ticket", header: "Ticket", width: "fit", cell: (row) => row.ticket },
              { id: "price", header: "Price", width: "fit", align: "end", cell: (row) => row.price },
              { id: "used", header: "Used", width: "fit", align: "end", cell: (row) => row.used },
            ]}
          />
        </PanelBody>
      </Panel>
      <Panel aria-label="Payment">
        <PanelHeader
          title="Payment"
          menu={<Menu label="Payment actions" align="end" items={[{ id: "edit", label: "Edit settings" }]} />}
        />
        <PanelBody>
          <DescriptionList
            items={[
              { term: "Currency", value: "US dollar (USD)" },
              { term: "Payment reminders", value: "Every 3 days, for 14 days" },
              { term: "Unpaid tickets", value: "Stay open until the person or an organizer cancels" },
            ]}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

function TicketPricesEdit() {
  return (
    <Panel aria-label="Edit prices">
      <form noValidate>
        <PanelHeader title="Edit prices">
          <Button type="button">Cancel</Button>
          <Button type="submit" variant="primary">
            Save prices
          </Button>
        </PanelHeader>
        <PanelBody>
          <p class="pk-small pk-muted">
            Enter 0 for free. Each change starts at midnight in Amsterdam (Europe/Amsterdam) on its date.
          </p>
        </PanelBody>
        <PanelBody flush>
          <TicketPriceTable
            periods={PERIODS}
            groups={GROUPS.map((group) => ({
              ...group,
              rows: group.rows.map((row) => ({
                ...row,
                prices: row.prices.map((price) => (price === "Free" ? "" : price.replace("$", ""))),
              })),
            }))}
            editor={{
              priceName: (row, period) => `${row}-${period}`,
              periodName: (period) => period,
              chargedName: (row) => `${row}-charged`,
              invalid: () => false,
              onPrice: () => {},
              onCharged: () => {},
              onPeriodDate: () => {},
              onAddPeriod: () => {},
              onRemovePeriod: () => {},
              onRemoveRow: () => {},
              addRow: () => (
                <Button type="button" variant="ghost">
                  Add a price
                </Button>
              ),
            }}
          />
        </PanelBody>
      </form>
    </Panel>
  );
}

export const eventTicketSections: PreviewSection[] = [
  { id: "ticket-payment", title: "Ticket: awaiting payment", render: () => <TicketAwaitingPayment /> },
  { id: "ticket-unpaid", title: "Ticket: unpaid, on the event home", render: () => <TicketUnpaidStanding /> },
  { id: "ticket-sales", title: "Organizer: ticket sales", render: () => <TicketSalesPreview /> },
  { id: "ticket-step", title: "Registration: choose a ticket", render: () => <AttendanceWithTicketChoice /> },
  { id: "ticket-step-assigned", title: "Registration: ticket known", render: () => <AttendanceWithAssignedTicket /> },
  {
    id: "ticket-step-personal",
    title: "Registration: personal address",
    render: () => <AttendanceWithPersonalAddress />,
  },
  { id: "ticket-step-day-prices", title: "Registration: prices per day", render: () => <AttendanceWithDayPrices /> },
  {
    id: "ticket-step-long-schedule",
    title: "Registration: prices on a long schedule",
    render: () => <AttendanceWithLongSchedule />,
  },
  { id: "ticket-step-free", title: "Registration: free event", render: () => <AttendanceWithFreeTicket /> },
  { id: "ticket-settings", title: "Event settings: tickets", render: () => <TicketSettings /> },
  { id: "ticket-prices-edit", title: "Event settings: edit prices", render: () => <TicketPricesEdit /> },
];
