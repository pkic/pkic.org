/**
 * Sponsor passes: how many staff passes and customer invitations each sponsor
 * tier gives, and the action that turns them into two codes per sponsor.
 */
import { useState } from "preact/hooks";
import { postJson, putJson } from "../../../../../../../shared/api-client";
import {
  eventTicketSponsorCodesResponseSchema,
  eventTicketSponsorPassesUpdateSchema,
  eventTicketsChangeResponseSchema,
  type EventTicketsConfiguration,
} from "../../../../../../../../shared/schemas/event-tickets";
import { formatNumber } from "../../../../../../../../shared/format-number";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { DataTable } from "../../../../../../../ui/DataTable";
import { Field, type FieldControlProps } from "../../../../../../../ui/Field";
import { Menu } from "../../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../../../ui/TextControl";
import { toast } from "../../../../../ui";
import { ticketsEndpoint } from "./tickets-endpoint";

type Tier = EventTicketsConfiguration["sponsorPasses"]["tiers"][number];
interface DraftTier {
  tierName: string;
  staff: string;
  customers: string;
}

const count = (value: string) => (value.trim() === "" ? 0 : Number(value));

export function SponsorPassesPanel({
  slug,
  configuration,
  canWrite,
  onChanged,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const saved = configuration.sponsorPasses;
  const tickets = configuration.types.filter((type) => type.active);
  const draftOf = (): DraftTier[] =>
    saved.tiers.map((tier) => ({
      tierName: tier.tierName,
      staff: String(tier.staffPasses),
      customers: String(tier.customerPasses),
    }));
  const [editing, setEditing] = useState(false);
  const [tiers, setTiers] = useState<DraftTier[]>(draftOf);
  const [staffTicket, setStaffTicket] = useState(saved.staffTicketTypeId ?? "");
  const [customerTicket, setCustomerTicket] = useState(saved.customerTicketTypeId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(eventTicketSponsorPassesUpdateSchema, {
    expectedRevision: configuration.revision,
    staffTicketTypeId: staffTicket || null,
    customerTicketTypeId: customerTicket || null,
    tiers: tiers.map((tier) => ({
      tierName: tier.tierName,
      staffPasses: count(tier.staff),
      customerPasses: count(tier.customers),
    })),
  });
  function reset() {
    setTiers(draftOf());
    setStaffTicket(saved.staffTicketTypeId ?? "");
    setCustomerTicket(saved.customerTicketTypeId ?? "");
    form.reset();
    setError("");
  }
  async function save(submitEvent: Event) {
    submitEvent.preventDefault();
    if (!editing || saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      await putJson(`${ticketsEndpoint(slug)}/sponsors/passes`, checked.data, eventTicketsChangeResponseSchema);
      await onChanged();
      setEditing(false);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  async function issue() {
    try {
      const result = await postJson(
        `${ticketsEndpoint(slug)}/sponsors/codes`,
        {},
        eventTicketSponsorCodesResponseSchema,
      );
      await onChanged();
      toast(
        result.created || result.raised
          ? `${formatNumber(result.created)} codes created, ${formatNumber(result.raised)} raised.`
          : "Every sponsor already has its codes.",
        "success",
      );
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The codes could not be created. Try again.", "error");
    }
  }
  // Nothing to set up until the event has a sponsor tier.
  if (saved.tiers.length === 0) return null;
  const setTier = (index: number, change: Partial<DraftTier>) =>
    setTiers((current) => current.map((tier, position) => (position === index ? { ...tier, ...change } : tier)));
  const ticketName = (id: string | null) => configuration.types.find((type) => type.id === id)?.name ?? "Not chosen";
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
    <Panel aria-label="Sponsor passes">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader
          title="Sponsor passes"
          menu={
            canWrite && !editing ? (
              <Menu
                label="Sponsor pass actions"
                align="end"
                items={[
                  {
                    id: "edit",
                    label: "Edit passes",
                    onSelect: () => {
                      reset();
                      setEditing(true);
                    },
                  },
                  { id: "issue", label: "Create codes for sponsors", onSelect: () => void issue() },
                ]}
              />
            ) : undefined
          }
        >
          {editing && (
            <>
              <Button
                type="button"
                disabled={saving}
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={saving} disabled={saving}>
                Save passes
              </Button>
            </>
          )}
        </PanelHeader>
        {editing ? (
          <PanelBody class="pk-stack">
            <div class="pk-cluster pk-cluster--start">
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
        ) : (
          <>
            <PanelBody flush>
              <DataTable<Tier>
                caption="Sponsor passes by tier"
                rows={saved.tiers}
                rowKey={(row) => row.tierName}
                columns={[
                  { id: "tier", header: "Tier", cell: (row) => <strong>{row.tierName}</strong> },
                  {
                    id: "staff",
                    header: "Staff passes",
                    width: "fit",
                    align: "end",
                    cell: (row) => formatNumber(row.staffPasses),
                  },
                  {
                    id: "customers",
                    header: "Customer invitations",
                    width: "fit",
                    align: "end",
                    cell: (row) => formatNumber(row.customerPasses),
                  },
                  {
                    id: "sponsors",
                    header: "Sponsors",
                    width: "fit",
                    align: "end",
                    cell: (row) => formatNumber(row.sponsors),
                  },
                  {
                    id: "codes",
                    header: "With codes",
                    width: "fit",
                    align: "end",
                    cell: (row) => formatNumber(row.sponsorsWithCodes),
                  },
                ]}
              />
            </PanelBody>
            <PanelBody>
              <p class="pk-small pk-muted">
                Staff passes give the {ticketName(saved.staffTicketTypeId)} ticket and customer invitations the{" "}
                {ticketName(saved.customerTicketTypeId)} ticket, both free. Each sponsor gets one code per kind.
              </p>
            </PanelBody>
          </>
        )}
      </form>
    </Panel>
  );
}
