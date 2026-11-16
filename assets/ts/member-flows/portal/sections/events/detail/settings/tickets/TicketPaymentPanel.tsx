/** The event's payment settings: its currency and how long unpaid tickets are reminded. */
import { useState } from "preact/hooks";
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import { Alert } from "../../../../../../../ui/Alert";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { DescriptionList } from "../../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../../ui/EditActions";
import { Field } from "../../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { TextInput } from "../../../../../../../ui/TextControl";
import { useTicketSettingsForm } from "./ticket-settings-form";

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

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
  const [sendInvoice, setSendInvoice] = useState(saved.sendInvoice);
  const refundDaysOf = () => (saved.refundDaysBeforeEvent === null ? "" : String(saved.refundDaysBeforeEvent));
  const [refundDays, setRefundDays] = useState(refundDaysOf);
  const { form, editing, saving, error, save, edit, cancel } = useTicketSettingsForm(
    slug,
    configuration.revision,
    {
      currency: currency.trim().toLowerCase(),
      reminderIntervalDays: interval.trim() === "" ? undefined : Number(interval),
      reminderPeriodDays: period.trim() === "" ? undefined : Number(period),
      sendInvoice,
      refundDaysBeforeEvent: refundDays.trim() === "" ? null : Number(refundDays),
    },
    onSaved,
    () => {
      setCurrency(saved.currency.toUpperCase());
      setInterval(String(saved.reminderIntervalDays));
      setPeriod(String(saved.reminderPeriodDays));
      setSendInvoice(saved.sendInvoice);
      setRefundDays(refundDaysOf());
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
                help="Reminders stop after this many days. The ticket stays unpaid until the person or an organizer cancels the registration. Enter 0 to send no reminders."
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
                {...form.of("refundDaysBeforeEvent")}
                label="Refunds until (days before the event)"
                help="Until then, a person who cancels gets their money back, and one who moves to days that cost less gets the difference. Leave empty for no refunds. You can always refund a ticket yourself."
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
                {
                  term: "Refunds",
                  value:
                    saved.refundDaysBeforeEvent === null
                      ? "None"
                      : saved.refundDaysBeforeEvent === 0
                        ? "Until the event starts"
                        : `Until ${days(saved.refundDaysBeforeEvent)} before the event`,
                },
                {
                  term: "Unpaid tickets",
                  value: "Stay open until the person or an organizer cancels the registration",
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
