/**
 * The notice a page about the registration shows while its ticket is not
 * settled: what stands in the way and, when the person can act, the way to
 * the ticket page. Nothing for a settled ticket.
 */
import { eventTicketPath } from "../../../../shared/event-participation-link";
import { TICKET_STANDING_COPY, ticketStanding } from "../../../../shared/event-ticket-standing";
import { Alert } from "../../../ui/Alert";
import { ButtonLink } from "../../../ui/Button";

export function TicketStandingNotice({
  eventSlug,
  paymentDue,
  paymentProcessing,
}: {
  eventSlug: string;
  paymentDue: boolean;
  paymentProcessing: boolean;
}) {
  const standing = ticketStanding({ paymentDue, paymentProcessing });
  if (standing === "settled") return null;
  const copy = TICKET_STANDING_COPY[standing];
  return (
    <Alert tone={copy.tone} title={copy.noticeTitle}>
      <p>{copy.body}</p>
      {copy.action && (
        <div class="pk-cluster">
          <ButtonLink href={eventTicketPath(eventSlug)} variant="secondary">
            {copy.action}
          </ButtonLink>
        </div>
      )}
    </Alert>
  );
}
