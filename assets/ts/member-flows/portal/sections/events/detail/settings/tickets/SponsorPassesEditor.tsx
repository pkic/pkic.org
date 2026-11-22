/**
 * Edit sponsor passes: which tickets the passes give, and how many staff
 * passes and customer invitations each sponsor tier gets. Its own page under
 * the tickets tab, saved as one request.
 */
import { useState } from "preact/hooks";
import { putJson } from "../../../../../../../shared/api-client";
import {
  eventTicketSponsorPassesUpdateSchema,
  eventTicketsChangeResponseSchema,
  type EventTicketsConfiguration,
} from "../../../../../../../../shared/schemas/event-tickets";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { Field, type FieldControlProps } from "../../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../../../ui/TextControl";
import { ticketsEndpoint } from "./tickets-endpoint";

interface DraftTier {
  tierName: string;
  staff: string;
  customers: string;
}

const count = (value: string) => (value.trim() === "" ? 0 : Number(value));

export function SponsorPassesEditor({
  slug,
  configuration,
  onSaved,
  onCancel,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const saved = configuration.sponsorPasses;
  const tickets = configuration.types.filter((type) => type.active);
  const [tiers, setTiers] = useState<DraftTier[]>(() =>
    saved.tiers.map((tier) => ({
      tierName: tier.tierName,
      staff: String(tier.staffPasses),
      customers: String(tier.customerPasses),
    })),
  );
  const [staffTicket, setStaffTicket] = useState(saved.staffTicketTypeId ?? "");
  const [customerTicket, setCustomerTicket] = useState(saved.customerTicketTypeId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The revision the draft was copied from: a save of an older draft is refused instead of overwriting newer counts.
  const [draftRevision] = useState(configuration.revision);
  const form = useContractForm(eventTicketSponsorPassesUpdateSchema, {
    expectedRevision: draftRevision,
    staffTicketTypeId: staffTicket || null,
    customerTicketTypeId: customerTicket || null,
    tiers: tiers.map((tier) => ({
      tierName: tier.tierName,
      staffPasses: count(tier.staff),
      customerPasses: count(tier.customers),
    })),
  });
  async function save(submitEvent: Event) {
    submitEvent.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      await putJson(`${ticketsEndpoint(slug)}/sponsors/passes`, checked.data, eventTicketsChangeResponseSchema);
      await onSaved();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  const setTier = (index: number, change: Partial<DraftTier>) =>
    setTiers((current) => current.map((tier, position) => (position === index ? { ...tier, ...change } : tier)));
  const ticketSelect = (control: FieldControlProps, name: string, value: string, onChange: (value: string) => void) => (
    <Select {...control} name={name} onChange={(event) => onChange(event.currentTarget.value)}>
      <option value="" selected={value === ""}>
        Choose a ticket
      </option>
      {tickets.map((type) => (
        <option key={type.id} value={type.id} selected={type.id === value}>
          {type.name}
        </option>
      ))}
    </Select>
  );
  return (
    <Panel aria-label="Edit sponsor passes">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Edit sponsor passes">
          <Button type="button" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={saving}>
            Save passes
          </Button>
        </PanelHeader>
        <PanelBody class="pk-stack">
          <div class="pk-stack">
            <Field {...form.of("staffTicketTypeId")} label="Ticket for staff passes">
              {(control) => ticketSelect(control, "staffTicketTypeId", staffTicket, setStaffTicket)}
            </Field>
            <Field
              {...form.of("customerTicketTypeId")}
              label="Ticket for customer invitations"
              help="Choose an attendee ticket, so invitations cannot be used for vendor staff."
            >
              {(control) => ticketSelect(control, "customerTicketTypeId", customerTicket, setCustomerTicket)}
            </Field>
          </div>
          {tiers.map((tier, index) => (
            <fieldset class="pk-fieldset pk-field" key={tier.tierName} disabled={saving}>
              <legend class="pk-field__label">{tier.tierName}</legend>
              <div class="pk-cluster pk-cluster--start">
                <Field {...form.of(`tiers.${index}.staffPasses`)} label="Staff passes">
                  {(control) => (
                    <TextInput
                      {...control}
                      name={`tiers.${index}.staffPasses`}
                      type="number"
                      inputMode="numeric"
                      value={tier.staff}
                      onInput={(event) => setTier(index, { staff: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field {...form.of(`tiers.${index}.customerPasses`)} label="Customer invitations">
                  {(control) => (
                    <TextInput
                      {...control}
                      name={`tiers.${index}.customerPasses`}
                      type="number"
                      inputMode="numeric"
                      value={tier.customers}
                      onInput={(event) => setTier(index, { customers: event.currentTarget.value })}
                    />
                  )}
                </Field>
              </div>
            </fieldset>
          ))}
          <p class="pk-small pk-muted">
            Raising a tier raises its sponsors' codes the next time you create codes. A code's limit is never lowered.
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}
