/** Gallery specimen: the registrant's ticket page while the ticket awaits payment. */
import { registrationTicketSchema } from "../../../shared/schemas/event-tickets";
import { EventTicketPayment } from "../../member-flows/portal/sections/events/app/EventTicketPayment";

/** The ticket page while a ticket awaits payment: what is owed, the way to pay, and the refund terms. */
export function TicketAwaitingPayment() {
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
    </div>
  );
}
