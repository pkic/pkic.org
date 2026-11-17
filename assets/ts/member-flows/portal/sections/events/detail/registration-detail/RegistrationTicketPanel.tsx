/**
 * A registration's ticket as an organizer sees it: what it is, what it cost,
 * where the payment stands, and the two decisions only an organizer takes —
 * refunding it and settling a disputed ticket.
 */
import { useState } from "preact/hooks";
import { successResponseSchema } from "../../../../../../../shared/schemas/api-common";
import {
  registrationTicketRefundSchema,
  registrationTicketResponseSchema,
  registrationTicketSyncResponseSchema,
  type RegistrationTicket,
} from "../../../../../../../shared/schemas/event-tickets";
import { TICKET_STATUS_LABELS, type TicketAssignmentSource } from "../../../../../../../shared/event-tickets";
import { formatTicketAmount, formatTicketMoney } from "../../../../../../../shared/event-ticket-display";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useData } from "../../../../../../hooks/useData";
import { getJson, postJson } from "../../../../../../shared/api-client";
import { Alert } from "../../../../../../ui/Alert";
import { Badge } from "../../../../../../ui/Badge";
import { Button } from "../../../../../../ui/Button";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Menu, type MenuItem } from "../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Textarea } from "../../../../../../ui/TextControl";
import { fmt, toast } from "../../../../ui";

const SOURCE_LABELS: Record<TicketAssignmentSource, string> = {
  code: "With a code",
  organizer: "Decided by an organizer",
  classifier: "Decided for the organization",
  chosen: "Chosen by the person",
  default: "Default ticket",
  disputed: "Chosen by the person, against the decision",
};

function status(ticket: RegistrationTicket) {
  if (ticket.refundPending) return <Badge tone="warn">Refund on its way</Badge>;
  if (ticket.status === "pending_payment") return <Badge tone="warn">{TICKET_STATUS_LABELS.pending_payment}</Badge>;
  if (ticket.status === "refunded" || ticket.status === "canceled")
    return <Badge tone="danger">{TICKET_STATUS_LABELS[ticket.status]}</Badge>;
  return ticket.paidAt ? `Paid ${fmt(ticket.paidAt)}` : TICKET_STATUS_LABELS[ticket.status];
}

export function RegistrationTicketPanel({
  slug,
  registrationId,
  canManage,
  onChanged,
}: {
  slug: string;
  registrationId: string;
  canManage: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/registrations/${encodeURIComponent(registrationId)}/ticket`;
  const loaded = useData(() => getJson(endpoint, registrationTicketResponseSchema), [endpoint]);
  const [refunding, setRefunding] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(registrationTicketRefundSchema, { reason });
  const ticket = loaded.data?.ticket;
  // A failed read is said, with a way to try again; it is not the same as an event without tickets.
  if (!loaded.loading && loaded.error && !loaded.data)
    return (
      <Panel aria-label="Ticket">
        <PanelHeader title="Ticket" />
        <PanelBody class="pk-stack">
          <Alert tone="danger">{loaded.error}</Alert>
          <div class="pk-cluster">
            <Button onClick={() => void loaded.reload()}>Try again</Button>
          </div>
        </PanelBody>
      </Panel>
    );
  // An event without tickets has nothing to show here.
  if (!ticket) return null;
  async function changed(message: string) {
    await loaded.reload();
    await onChanged?.();
    toast(message, "success");
  }
  async function refund() {
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      await postJson(`${endpoint}/refunds`, checked.data, successResponseSchema);
      setRefunding(false);
      setReason("");
      form.reset();
      await changed("Refund requested. The ticket shows as refunded once the payment provider confirms it.");
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  async function review(decision: "keep" | "move") {
    const confirmed = await confirmAction(
      decision === "keep"
        ? {
            title: `Keep the ${ticket!.ticketName} ticket?`,
            body: "Everyone else from this organization gets this ticket from now on.",
            confirmLabel: "Keep this ticket",
          }
        : {
            title: "Move to the ticket decided for the organization?",
            body: "The ticket changes to today's price for that ticket. If it costs money, the person is emailed a request to pay.",
            confirmLabel: "Move the ticket",
          },
    );
    if (!confirmed) return;
    try {
      await postJson(`${endpoint}/review`, { decision }, successResponseSchema);
      await changed(decision === "keep" ? "Ticket kept." : "Ticket moved.");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The ticket could not be changed. Try again.", "error");
    }
  }
  async function sync() {
    if (saving) return;
    setSaving(true);
    try {
      const synced = await postJson(`${endpoint}/sync`, {}, registrationTicketSyncResponseSchema);
      await changed(
        synced.changed
          ? "Ticket updated from the payment provider."
          : "The ticket already matches the payment provider.",
      );
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The payment provider could not be read. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }
  const actions: MenuItem[] = canManage
    ? [
        ...(ticket.disputed
          ? [
              { id: "keep", label: "Keep this ticket", onSelect: () => void review("keep") },
              { id: "move", label: "Move to the decided ticket", onSelect: () => void review("move") },
            ]
          : []),
        ...(ticket.status === "paid" && !ticket.refundPending && ticket.paidAmount > ticket.refundedAmount
          ? [{ id: "refund", label: "Refund ticket", onSelect: () => setRefunding(true) }]
          : []),
        // A ticket that never cost anything has no payment to read.
        ...(ticket.amount > 0 || ticket.paidAmount > 0
          ? [{ id: "sync", label: "Update from payment provider", onSelect: () => void sync() }]
          : []),
      ]
    : [];
  return (
    <Panel aria-label="Ticket">
      <PanelHeader
        title="Ticket"
        menu={actions.length > 0 ? <Menu label="Ticket actions" align="end" items={actions} /> : undefined}
      />
      <PanelBody class="pk-stack">
        {ticket.disputed && (
          <Alert tone="warn" title="The person chose another ticket than the one decided for their organization">
            {ticket.disputeReason}
          </Alert>
        )}
        {ticket.refundFailed && !ticket.refundPending && (
          <Alert tone="danger" title="The refund did not go through">
            {ticket.status === "paid"
              ? "Nothing was returned. Refund the ticket again, or return the payment at the payment provider."
              : "Return the payment at the payment provider, using the payment reference below."}
          </Alert>
        )}
        <DescriptionList
          density="compact"
          items={[
            { term: "Ticket", value: ticket.ticketName },
            { term: "Price", value: formatTicketAmount(ticket.amount, ticket.currency) },
            { term: "Payment", value: status(ticket) },
            { term: "Given", value: SOURCE_LABELS[ticket.source] },
            ...(ticket.codeLabel ? [{ term: "Code", value: ticket.codeLabel }] : []),
            // After a move to days that cost less, what was paid is more than the price.
            ...(ticket.paidAmount !== ticket.amount && ticket.paidAmount > 0
              ? [{ term: "Paid", value: formatTicketMoney(ticket.paidAmount, ticket.currency) }]
              : []),
            ...(ticket.paymentReference ? [{ term: "Payment reference", value: ticket.paymentReference }] : []),
            ...(ticket.refundedAmount > 0
              ? [{ term: "Refunded", value: formatTicketMoney(ticket.refundedAmount, ticket.currency) }]
              : []),
          ]}
        />
      </PanelBody>
      <Dialog
        open={refunding}
        title="Refund ticket"
        description={`${formatTicketMoney(ticket.paidAmount - ticket.refundedAmount, ticket.currency)} goes back to the person's payment method. Their in-person place ends when the refund is confirmed.`}
        confirmLabel="Refund ticket"
        confirmDisabled={saving}
        destructive
        onConfirm={() => void refund()}
        onCancel={() => {
          setRefunding(false);
          setError("");
        }}
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
    </Panel>
  );
}
