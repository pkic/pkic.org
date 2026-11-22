/** Gallery specimen: the registrant's ticket page while the ticket awaits payment. */
import { registrationTicketSchema } from "../../../shared/schemas/event-tickets";
import { TicketCard } from "../../member-flows/portal/sections/events/app/EventHome";
import type { ParticipantEventDetail } from "../../member-flows/portal/sections/events/app/event-app-model";
import { EventRegister } from "../../member-flows/portal/sections/events/app/EventRegister";
import { EventTicketPayment } from "../../member-flows/portal/sections/events/app/EventTicketPayment";
import { TicketStandingNotice } from "../../components/events/tickets/TicketStandingNotice";

const ticket = registrationTicketSchema.parse({
  id: "20000000-0000-4000-8000-0000000000aa",
  ticketKey: "attendee",
  ticketName: "Attendee",
  source: "default",
  status: "pending_payment",
  amount: 19500,
  currency: "usd",
  codeLabel: null,
  paidAt: null,
  disputed: false,
  disputeReason: null,
  refundPending: false,
  refundFailed: false,
  paymentReference: null,
  refundableUntil: "2099-11-24T08:00:00.000Z",
  refundFee: 1000,
  refundedAmount: 0,
});

/** The ticket page while a ticket awaits payment: what is owed, the way to pay, and the refund terms. */
export function TicketAwaitingPayment() {
  return (
    <div class="pk-stack">
      <EventTicketPayment
        slug="example"
        registrationId="20000000-0000-4000-8000-0000000000ab"
        ticket={ticket}
        details={<a href="#ticket-payment">Registration details</a>}
      />
      <EventTicketPayment
        slug="example"
        registrationId="20000000-0000-4000-8000-0000000000ab"
        ticket={{ ...ticket, refundableUntil: null, refundFee: 0 }}
        details={<a href="#ticket-payment">Registration details</a>}
      />
      <EventTicketPayment
        slug="example"
        registrationId="20000000-0000-4000-8000-0000000000ab"
        ticket={{ ...ticket, paymentProcessing: true }}
        details={<a href="#ticket-payment">Registration details</a>}
      />
    </div>
  );
}

/** A payment under review leaves the ticket visible without admission or another payment action. */
export function TicketPaymentUnderReview() {
  return (
    <EventTicketPayment
      slug="example"
      registrationId="20000000-0000-4000-8000-0000000000ab"
      ticket={{ ...ticket, status: "payment_under_review" }}
      details={<a href="#ticket-under-review">Registration details</a>}
    />
  );
}

/** The event home and the registration page while the ticket awaits payment: neither says "registered". */
export function TicketUnpaidStanding() {
  // Only what the card reads; the rest of an event plays no part in it.
  const event = {
    slug: "example",
    participation: { registrationId: "20000000-0000-4000-8000-0000000000ab", registrationStatus: "registered" },
    viewer: {
      registrationStatus: "registered",
      waitlisted: false,
      paymentDue: true,
      holdsWorkAddress: true,
      days: [
        { date: "2027-11-16", attendanceType: "in_person", accessMode: "physical", state: "registered" },
        { date: "2027-11-17", attendanceType: "in_person", accessMode: "physical", state: "registered" },
      ],
    },
  } as ParticipantEventDetail;
  return (
    <div class="pk-stack">
      <div class="pk-grid pk-grid--cards">
        <TicketCard event={event} ended={false} />
      </div>
      <EventRegister event={event} />
      <TicketStandingNotice eventSlug="example" paymentDue paymentProcessing={false} />
      <TicketStandingNotice eventSlug="example" paymentDue paymentProcessing />
    </div>
  );
}
