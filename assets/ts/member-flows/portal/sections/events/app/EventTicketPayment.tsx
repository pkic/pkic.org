/**
 * The ticket page while a ticket is not settled: what is owed and the way to
 * pay it. The badge and check-in code appear only once the ticket is paid.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  registrationTicketCheckoutResponseSchema,
  registrationTicketSyncResponseSchema,
  type RegistrationTicket,
} from "../../../../../../shared/schemas/event-tickets";
import { TICKET_STANDING_COPY } from "../../../../../../shared/event-ticket-standing";
import { formatDateTime } from "../../../../../../shared/format-date";
import { formatTicketMoney, ticketRefundNote } from "../../../../../../shared/event-ticket-display";
import { postJson } from "../../../../../shared/api-client";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { Spinner } from "../../../../../components/Spinner";
import { EventCard } from "./EventCard";

export function EventTicketPayment({
  slug,
  registrationId,
  ticket,
  details,
  onSettled,
}: {
  slug: string;
  registrationId: string;
  ticket: RegistrationTicket;
  details: ComponentChildren;
  /** The payment turned out to have arrived, so the ticket is read again. */
  onSettled?: () => unknown;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const unpaid = ticket.status === "pending_payment";
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/registrations/${encodeURIComponent(registrationId)}/ticket`;
  // A person back from the payment page may be ahead of the provider's own notice, so the provider is asked once.
  const [checking, setChecking] = useState(unpaid);
  // The latest callback is called, without asking the provider again when the parent renders.
  const settled = useRef(onSettled);
  settled.current = onSettled;
  useEffect(() => {
    if (!unpaid) return;
    let current = true;
    void postJson(`${endpoint}/sync`, {}, registrationTicketSyncResponseSchema)
      .then(({ changed }) => (changed && current ? settled.current?.() : undefined))
      // Without an answer the page asks for the payment as before; paying twice is refused by the provider.
      .catch(() => undefined)
      .finally(() => current && setChecking(false));
    return () => {
      current = false;
    };
  }, [endpoint, unpaid]);
  async function pay() {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      const { checkoutUrl } = await postJson(`${endpoint}/checkout`, {}, registrationTicketCheckoutResponseSchema);
      window.location.assign(checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment could not be opened. Try again.");
      setOpening(false);
    }
  }
  if (ticket.status === "payment_under_review")
    return (
      <EventCard eyebrow={`${ticket.ticketName} ticket`} title="Payment under review">
        <p>
          Your badge and check-in code are unavailable while the payment is under review. Contact the event organizers.
        </p>
        <div class="pk-cluster">{details}</div>
      </EventCard>
    );
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
  if (checking) return <Spinner label="Checking your payment. This can take a few seconds…" />;
  if (ticket.paymentProcessing)
    return (
      <EventCard eyebrow={`${ticket.ticketName} ticket`} title={TICKET_STANDING_COPY.processing.title}>
        <p>{TICKET_STANDING_COPY.processing.body} Your badge and check-in code appear here then.</p>
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
      {ticket.payBy && (
        <p>Pay by {formatDateTime(ticket.payBy)} to keep your place. After that your registration is cancelled.</p>
      )}
      <p class="pk-small pk-muted">{ticketRefundNote(ticket)}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div class="pk-cluster">
        <Button variant="primary" loading={opening} disabled={opening} onClick={() => void pay()}>
          {TICKET_STANDING_COPY.to_pay.action}
        </Button>
        {details}
      </div>
    </EventCard>
  );
}
