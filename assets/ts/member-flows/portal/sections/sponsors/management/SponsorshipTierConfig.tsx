import { useEffect, useState } from "preact/hooks";
import {
  sponsorshipTierConfigResponseSchema,
  sponsorshipTierConfigUpdateSchema,
  type SponsorshipTierConfig,
} from "../../../../../../shared/schemas/sponsorship-management";
import { managedSponsorTiersResponseSchema } from "../../../../../../shared/schemas/sponsors";
import { statusLabel } from "../../../../../components/Badge";
import { EmptyState } from "../../../../../ui/RecordEmptyState";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../components/Spinner";
import { useContractForm } from "../../../../../hooks/useContractForm";
import { Field } from "../../../../../ui/Field";
import { Menu } from "../../../../../ui/Menu";
import { Button } from "../../../../../ui/Button";
import { FormSection } from "../../../../../ui/FormSection";
import { FormActions } from "../../../../../components/FormActions";
import { formatNumber } from "../../../../../../shared/format-number";
import { Checkbox } from "../../../../../ui/Checkbox";
import { DataTable, type DataTableColumn } from "../../../../../ui/DataTable";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { TextInput } from "../../../../../ui/TextControl";
import { getJson, patchJson } from "../../../../../shared/api-client";
import { toast } from "../../../ui";
const TIER_CONFIG_ENDPOINT = "/api/v1/sponsors/tiers";

export function SponsorshipTierConfig({ canWrite }: { canWrite: boolean }) {
  const [tiers, setTiers] = useState<SponsorshipTierConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ amountCents: 0, currency: "usd", active: true });
  const form = useContractForm(sponsorshipTierConfigUpdateSchema, draft);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(`${TIER_CONFIG_ENDPOINT}?includeInactive=true`, managedSponsorTiersResponseSchema);
      setTiers(response.tiers);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(tier: SponsorshipTierConfig, event: Event) {
    event.preventDefault();
    if (!canWrite || editingId !== tier.id || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchJson(
        `${TIER_CONFIG_ENDPOINT}/${encodeURIComponent(tier.id)}`,
        checked.data,
        sponsorshipTierConfigResponseSchema,
      );
      toast(`${tier.sponsorType} ${tier.tier} saved`, "success");
      setEditingId(null);
      await load();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (saving) return;
    setEditingId(null);
    setError(null);
    form.reset();
  }
  const editing = canWrite ? tiers.find((tier) => tier.id === editingId) : undefined;
  if (editing)
    return (
      <div class="pk pk-stack">
        <Panel aria-label="Edit sponsorship tier pricing">
          <PanelHeader title={`Edit ${statusLabel(editing.sponsorType)} ${editing.tier} pricing`}>
            <Button disabled={saving} onClick={cancelEdit}>
              Back to pricing
            </Button>
          </PanelHeader>
          <PanelBody>
            <form noValidate {...form.handlers} onSubmit={(event) => void save(editing, event)} class="pk-form">
              {error && <ErrorAlert error={error} />}
              <FormSection title="Pricing">
                <Field label={`${editing.tier} amount in cents`} {...form.of("amountCents")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="amountCents"
                      type="number"
                      min="0"
                      disabled={saving}
                      value={draft.amountCents}
                      onInput={(event) => setDraft({ ...draft, amountCents: event.currentTarget.valueAsNumber })}
                    />
                  )}
                </Field>
                <Field label={`${editing.tier} currency`} {...form.of("currency")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="currency"
                      disabled={saving}
                      maxLength={3}
                      value={draft.currency}
                      onInput={(event) => setDraft({ ...draft, currency: event.currentTarget.value })}
                    />
                  )}
                </Field>
                <Field label="Availability" {...form.of("active")}>
                  {(control) => (
                    <Checkbox
                      {...control}
                      name="active"
                      checked={draft.active}
                      disabled={saving}
                      onChange={(event) => setDraft({ ...draft, active: event.currentTarget.checked })}
                      label={`${editing.tier} active`}
                    />
                  )}
                </Field>
              </FormSection>
              <FormActions submitLabel="Save pricing" busyLabel="Saving pricing…" busy={saving} onCancel={cancelEdit} />
            </form>
          </PanelBody>
        </Panel>
      </div>
    );

  const columns: ReadonlyArray<DataTableColumn<SponsorshipTierConfig>> = [
    { id: "type", header: "Type", cell: (tier) => statusLabel(tier.sponsorType) },
    { id: "tier", header: "Tier", cell: (tier) => tier.tier },
    {
      id: "amount",
      header: "Amount (cents)",
      align: "end",
      width: "fit",
      cell: (tier) => formatNumber(tier.amountCents),
    },
    { id: "currency", header: "Currency", cell: (tier) => tier.currency },
    { id: "active", header: "Active", cell: (tier) => (tier.active ? "Yes" : "No") },
    ...(canWrite
      ? [
          {
            id: "actions",
            header: "Actions",
            headerHidden: true,
            align: "end" as const,
            cell: (tier: SponsorshipTierConfig) => (
              <Menu
                label={`${statusLabel(tier.sponsorType)} ${tier.tier} pricing actions`}
                align="end"
                items={[
                  {
                    id: "edit",
                    label: "Edit pricing",
                    disabled: saving,
                    onSelect: () => {
                      setDraft({ amountCents: tier.amountCents, currency: tier.currency, active: tier.active });
                      setEditingId(tier.id);
                      setError(null);
                      form.reset();
                    },
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div class="pk">
      <Panel aria-label="Sponsorship tier pricing">
        <PanelHeader title="Sponsorship tier pricing" />
        {loading && (
          <PanelBody>
            <Spinner />
          </PanelBody>
        )}
        {!loading && error && (
          <PanelBody>
            <ErrorAlert error={error} />
          </PanelBody>
        )}
        {!loading && (!error || tiers.length > 0) && (
          <DataTable
            caption="Sponsorship tier pricing"
            columns={columns}
            rows={tiers}
            rowKey={(tier) => tier.id}
            empty={<EmptyState title="No tier pricing is configured." />}
          />
        )}
      </Panel>
    </div>
  );
}
