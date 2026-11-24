/**
 * An organizer refunds a paid ticket: the amount that goes back, and the
 * reason kept with the refund. One dialog for the registration's ticket
 * panel and the event's list of tickets.
 */
import { useState } from "preact/hooks";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { registrationTicketRefundSchema } from "../../../../shared/schemas/registration-tickets";
import { formatTicketMoney } from "../../../../shared/event-ticket-display";
import { useContractForm } from "../../../hooks/useContractForm";
import { postJson } from "../../../shared/api-client";
import { Alert } from "../../../ui/Alert";
import { Dialog } from "../../../ui/Dialog";
import { Field } from "../../../ui/Field";
import { Textarea } from "../../../ui/TextControl";

/** Whether a ticket has money an organizer can return. */
export function ticketRefundable(ticket: {
  status: string;
  refundPending: boolean;
  paidAmount: number;
  refundedAmount: number;
}): boolean {
  return ticket.status === "paid" && !ticket.refundPending && ticket.paidAmount > ticket.refundedAmount;
}

export function TicketRefundDialog({
  slug,
  registrationId,
  ticket,
  open,
  onClose,
  onRefunded,
}: {
  slug: string;
  registrationId: string;
  ticket: { paidAmount: number; refundedAmount: number; currency: string };
  open: boolean;
  onClose: () => void;
  onRefunded: () => unknown;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(registrationTicketRefundSchema, { reason });
  function close() {
    setError("");
    onClose();
  }
  async function refund() {
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      await postJson(
        `/api/v1/events/${encodeURIComponent(slug)}/registrations/${encodeURIComponent(registrationId)}/ticket/refunds`,
        checked.data,
        successResponseSchema,
      );
      setReason("");
      form.reset();
      onClose();
      await onRefunded();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      title="Refund ticket"
      description={`${formatTicketMoney(ticket.paidAmount - ticket.refundedAmount, ticket.currency)} goes back to the person's payment method. Their in-person place ends when the refund is confirmed.`}
      confirmLabel="Refund ticket"
      confirmDisabled={saving}
      destructive
      onConfirm={() => void refund()}
      onCancel={close}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          void refund();
        }}
      >
        <Field {...form.of("reason")} label="Reason" help="Kept with the refund for your records." required>
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              rows={3}
              value={reason}
              onInput={(event) => setReason(event.currentTarget.value)}
            />
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
