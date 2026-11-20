/** The event's payment settings: its currency and how long unpaid tickets are reminded. */
import { useState } from "preact/hooks";
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import {
  formatTicketMoney,
  parseTicketAmount,
  ticketAmountInput,
} from "../../../../../../../../shared/event-ticket-display";
import { Alert } from "../../../../../../../ui/Alert";
import { Checkbox, Radio } from "../../../../../../../ui/Checkbox";
import { DescriptionList } from "../../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../../ui/EditActions";
import { Field } from "../../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { TextInput } from "../../../../../../../ui/TextControl";
import { useTicketSettingsForm } from "./ticket-settings-form";

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

type RefundPolicy = "none" | "full" | "fee";

/** The saved policy in one line: none, until when, and the fee kept from a refund. */
function refundSummary(saved: EventTicketsConfiguration["settings"]): string {
  if (saved.refundDaysBeforeEvent === null) return "None";
  const until =
    saved.refundDaysBeforeEvent === 0
      ? "Until the event starts"
      : `Until ${days(saved.refundDaysBeforeEvent)} before the event`;
  return saved.refundFee > 0 ? `${until}, less a fee of ${formatTicketMoney(saved.refundFee, saved.currency)}` : until;
}

export function TicketPaymentPanel({
  slug,
  configuration,
  canWrite,
  onSaved,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  canWrite: boolean;
  onSaved: () => Promise<void>;
}) {
  const saved = configuration.settings;
  const [currency, setCurrency] = useState(saved.currency.toUpperCase());
  const [interval, setInterval] = useState(String(saved.reminderIntervalDays));
  const [period, setPeriod] = useState(String(saved.reminderPeriodDays));
  const holdOf = () => (saved.unpaidHoldDays === null ? "" : String(saved.unpaidHoldDays));
  const [hold, setHold] = useState(holdOf);
  const [retry, setRetry] = useState(String(saved.paymentRetryDays));
  const [sendInvoice, setSendInvoice] = useState(saved.sendInvoice);
  const refundPolicyOf = (): RefundPolicy =>
    saved.refundDaysBeforeEvent === null ? "none" : saved.refundFee > 0 ? "fee" : "full";
  const refundDaysOf = () => (saved.refundDaysBeforeEvent === null ? "" : String(saved.refundDaysBeforeEvent));
  const refundFeeOf = () => (saved.refundFee > 0 ? ticketAmountInput(saved.refundFee, saved.currency) : "");
  const [refundPolicy, setRefundPolicy] = useState<RefundPolicy>(refundPolicyOf);
  const [refundDays, setRefundDays] = useState(refundDaysOf);
  const [refundFee, setRefundFee] = useState(refundFeeOf);
  const { form, editing, saving, error, save, edit, cancel } = useTicketSettingsForm(
    slug,
    configuration.revision,
    {
      currency: currency.trim().toLowerCase(),
      reminderIntervalDays: interval.trim() === "" ? undefined : Number(interval),
      reminderPeriodDays: period.trim() === "" ? undefined : Number(period),
      // Empty keeps an unpaid place until someone cancels the registration.
      unpaidHoldDays: hold.trim() === "" ? null : Number(hold),
      paymentRetryDays: retry.trim() === "" ? undefined : Number(retry),
      sendInvoice,
      // An empty period or fee is left out, so the contract asks for it beside its field.
      refundDaysBeforeEvent: refundPolicy === "none" ? null : refundDays.trim() === "" ? undefined : Number(refundDays),
      refundFee:
        refundPolicy === "fee"
          ? refundFee.trim() === ""
            ? undefined
            : (parseTicketAmount(refundFee, currency.trim().toLowerCase()) ?? undefined)
          : 0,
    },
    onSaved,
    () => {
      setCurrency(saved.currency.toUpperCase());
      setInterval(String(saved.reminderIntervalDays));
      setPeriod(String(saved.reminderPeriodDays));
      setHold(holdOf());
      setRetry(String(saved.paymentRetryDays));
      setSendInvoice(saved.sendInvoice);
      setRefundPolicy(refundPolicyOf());
      setRefundDays(refundDaysOf());
      setRefundFee(refundFeeOf());
    },
  );
  return (
    <Panel aria-label="Payment">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Payment">
          {canWrite && (
            <EditActions
              label="Payment settings actions"
              editing={editing}
              saving={saving}
              saveLabel="Save payment settings"
              onEdit={edit}
              onCancel={cancel}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          {editing ? (
            <>
              <Field
                {...form.of("currency")}
                label="Currency"
                help="The three-letter code, such as USD. It can no longer change once someone holds a ticket that costs something."
                required
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="currency"
                    maxLength={3}
                    autocomplete="off"
                    value={currency}
                    onInput={(inputEvent) => setCurrency(inputEvent.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                {...form.of("reminderIntervalDays")}
                label="Remind every (days)"
                help="How often someone with an unpaid ticket is reminded to pay."
                required
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="reminderIntervalDays"
                    type="number"
                    inputMode="numeric"
                    value={interval}
                    onInput={(inputEvent) => setInterval(inputEvent.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                {...form.of("reminderPeriodDays")}
                label="Keep reminding for (days)"
                help="Reminders stop after this many days. Enter 0 to send no reminders."
                required
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="reminderPeriodDays"
                    type="number"
                    inputMode="numeric"
                    value={period}
                    onInput={(inputEvent) => setPeriod(inputEvent.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                {...form.of("unpaidHoldDays")}
                label="Keep an unpaid place for (days)"
                help="After this many days without payment the registration is cancelled and the person is told. A payment that is being processed keeps the place. Leave empty to keep unpaid places until someone cancels."
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="unpaidHoldDays"
                    type="number"
                    inputMode="numeric"
                    value={hold}
                    onInput={(inputEvent) => setHold(inputEvent.currentTarget.value)}
                  />
                )}
              </Field>
              <Field
                {...form.of("paymentRetryDays")}
                label="After a failed payment, keep the place for (days)"
                help="The person is told the payment failed and can pay again. After this many days the registration is cancelled."
                required
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="paymentRetryDays"
                    type="number"
                    inputMode="numeric"
                    value={retry}
                    onInput={(inputEvent) => setRetry(inputEvent.currentTarget.value)}
                  />
                )}
              </Field>
              <fieldset class="pk-fieldset pk-field" disabled={saving}>
                <legend class="pk-field__label">Refunds</legend>
                <div class="pk-stack pk-stack--tight">
                  <Radio
                    name="refundPolicy"
                    value="none"
                    checked={refundPolicy === "none"}
                    label="No refunds"
                    hint="Nothing is returned when a person cancels or moves to days that cost less."
                    onChange={() => setRefundPolicy("none")}
                  />
                  <Radio
                    name="refundPolicy"
                    value="full"
                    checked={refundPolicy === "full"}
                    label="Full refund until a number of days before the event"
                    hint="A person who cancels gets their money back, and one who moves to days that cost less gets the difference."
                    onChange={() => setRefundPolicy("full")}
                  />
                  <Radio
                    name="refundPolicy"
                    value="fee"
                    checked={refundPolicy === "fee"}
                    label="Refund until then, less an administration fee"
                    hint="The fee is kept from each refund, to cover costs that are not returned to you."
                    onChange={() => setRefundPolicy("fee")}
                  />
                </div>
                <p class="pk-small pk-muted">
                  A change applies to tickets paid after it. A ticket that is already paid keeps the policy it was paid
                  under.
                </p>
              </fieldset>
              {refundPolicy !== "none" && (
                <Field
                  {...form.of("refundDaysBeforeEvent")}
                  label="Refunds until (days before the event)"
                  help="Enter 0 to refund until the event starts."
                  required
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name="refundDaysBeforeEvent"
                      type="number"
                      inputMode="numeric"
                      value={refundDays}
                      onInput={(inputEvent) => setRefundDays(inputEvent.currentTarget.value)}
                    />
                  )}
                </Field>
              )}
              {refundPolicy === "fee" && (
                <Field
                  {...form.of("refundFee")}
                  label={`Administration fee (${currency.trim().toUpperCase()})`}
                  help="Kept from each refund this policy gives. A refund you make yourself returns everything."
                  required
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name="refundFee"
                      inputMode="decimal"
                      value={refundFee}
                      onInput={(inputEvent) => setRefundFee(inputEvent.currentTarget.value)}
                    />
                  )}
                </Field>
              )}
              <Checkbox
                name="sendInvoice"
                checked={sendInvoice}
                label="Send an invoice for each paid ticket"
                hint="The payment provider emails an invoice with the registration's reference, besides its receipt. It may charge a fee for each invoice."
                onChange={(event) => setSendInvoice(event.currentTarget.checked)}
              />
            </>
          ) : (
            <DescriptionList
              items={[
                { term: "Currency", value: saved.currency.toUpperCase() },
                {
                  term: "Payment reminders",
                  value:
                    saved.reminderPeriodDays === 0
                      ? "None"
                      : `Every ${days(saved.reminderIntervalDays)}, for ${days(saved.reminderPeriodDays)}`,
                },
                { term: "Invoices", value: saved.sendInvoice ? "Sent for each paid ticket" : "Receipt only" },
                { term: "Refunds", value: refundSummary(saved) },
                {
                  term: "Unpaid tickets",
                  value:
                    saved.unpaidHoldDays === null
                      ? "Kept until the person or an organizer cancels the registration"
                      : `Kept for ${days(saved.unpaidHoldDays)}, then the registration is cancelled`,
                },
                {
                  term: "After a failed payment",
                  value: `Kept for ${days(saved.paymentRetryDays)} to pay again, then the registration is cancelled`,
                },
              ]}
            />
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}
