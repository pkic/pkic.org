/**
 * The ticket page while a ticket is not settled: what is owed and the way to
 * pay it. The badge and check-in code appear only once the ticket is paid.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  registrationTicketCheckoutResponseSchema,
  type RegistrationTicket,
} from "../../../../../../shared/schemas/event-tickets";
import { formatTicketMoney, ticketRefundNote } from "../../../../../../shared/event-ticket-display";
import { postJson } from "../../../../../shared/api-client";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { EventCard } from "./EventCard";

export function EventTicketPayment({
  slug,
  registrationId,
  ticket,
  details,
}: {
  slug: string;
  registrationId: string;
  ticket: RegistrationTicket;
  details: ComponentChildren;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  async function pay() {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      const { checkoutUrl } = await postJson(
        `/api/v1/events/${encodeURIComponent(slug)}/registrations/${encodeURIComponent(registrationId)}/ticket/checkout`,
        {},
        registrationTicketCheckoutResponseSchema,
      );
      window.location.assign(checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment could not be opened. Try again.");
      setOpening(false);
    }
  }
  if (ticket.status === "refunded" || ticket.status === "canceled")
    return (
      <EventCard
        eyebrow="Ticket"
        title={ticket.status === "refunded" ? "Your ticket was refunded" : "Your ticket was canceled"}
      >
        <p>To attend, register again from the event page.</p>
        <div class="pk-cluster">{details}</div>
      </EventCard>
    );
  return (
    <EventCard
      eyebrow={`${ticket.ticketName} ticket`}
      title={`${formatTicketMoney(ticket.amount, ticket.currency)} to pay`}
    >
      <p>
        Your registration is saved. Your badge and check-in code appear here once the payment arrives, and we email your
        confirmation then.
      </p>
      <p class="pk-small pk-muted">{ticketRefundNote(ticket)}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div class="pk-cluster">
        <Button variant="primary" loading={opening} disabled={opening} onClick={() => void pay()}>
          Pay for your ticket
        </Button>
        {details}
      </div>
    </EventCard>
  );
}
