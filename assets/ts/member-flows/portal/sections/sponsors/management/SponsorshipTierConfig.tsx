import { useEffect, useState } from "preact/hooks";
import {
  sponsorshipTierConfigResponseSchema,
  sponsorshipTierConfigUpdateSchema,
  type SponsorshipTierConfig,
} from "../../../../../../shared/schemas/sponsorship-management";
import { managedSponsorTiersResponseSchema } from "../../../../../../shared/schemas/sponsors";
import { statusLabel } from "../../../../../components/Badge";
import { EmptyState } from "../../../../../components/EmptyState";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../components/Spinner";
import { useContractForm } from "../../../../../hooks/useContractForm";
import { Field } from "../../../../../ui/Field";
import { Menu } from "../../../../../ui/Menu";
import { Button } from "../../../../../ui/Button";
import { Checkbox } from "../../../../../ui/Checkbox";
import { DataTable, type DataTableColumn } from "../../../../../ui/DataTable";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { TextInput } from "../../../../../ui/TextControl";
import { getJson, patchJson } from "../../../../../shared/api-client";
import { toast } from "../../../ui";
// The `pk-check` trio below is written as class names rather than reached
// through a component, so this module names their stylesheet itself. `TextInput`
// already imports it; saying so here keeps the file honest if it is ever
// swapped for a plain input.
import "../../../../../ui/Field.css";

const TIER_CONFIG_ENDPOINT = "/api/v1/sponsors/tiers";

/** The row's edit form, which every control in the row submits through. */
const formIdFor = (tier: SponsorshipTierConfig) => `sponsorship-tier-${tier.id}`;

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

  const columns: ReadonlyArray<DataTableColumn<SponsorshipTierConfig>> = [
    // `statusLabel` is the repository's one string-to-label formatter, so the
    // type reads as "Consortium" without a `text-capitalize` class deciding it
    // in CSS — where a screen reader never sees the capitalization anyway.
    { id: "type", header: "Type", cell: (tier) => statusLabel(tier.sponsorType) },
    { id: "tier", header: "Tier", cell: (tier) => tier.tier },
    {
      id: "amount",
      header: "Amount (cents)",
      cell: (tier) =>
        canWrite && editingId === tier.id ? (
          <form id={formIdFor(tier)} noValidate onSubmit={(event) => void save(tier, event)}>
            <Field label={`${tier.tier} amount in cents`} {...form.of("amountCents")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="amountCents"
                  type="number"
                  min="0"
                  disabled={saving}
                  aria-label={`${tier.tier} amount in cents`}
                  value={draft.amountCents}
                  onInput={(event) => setDraft({ ...draft, amountCents: event.currentTarget.valueAsNumber })}
                />
              )}
            </Field>
          </form>
        ) : (
          tier.amountCents
        ),
    },
    {
      id: "currency",
      header: "Currency",
      cell: (tier) =>
        canWrite && editingId === tier.id ? (
          <Field label={`${tier.tier} currency`} {...form.of("currency")}>
            {(control) => (
              <TextInput
                {...control}
                form={formIdFor(tier)}
                name="currency"
                disabled={saving}
                maxLength={3}
                value={draft.currency}
                onInput={(event) => setDraft({ ...draft, currency: event.currentTarget.value })}
              />
            )}
          </Field>
        ) : (
          tier.currency
        ),
    },
    {
      id: "active",
      header: "Active",
      cell: (tier) =>
        canWrite && editingId === tier.id ? (
          /*
           * The name comes from real label text rather than an `aria-label`,
           * so it survives translation and matches what a speech-input user
           * would say; the text is hidden because the column header already
           * carries it visually.
           */
          <Checkbox
            form={formIdFor(tier)}
            name="active"
            checked={draft.active}
            disabled={saving}
            onChange={(event) => setDraft({ ...draft, active: event.currentTarget.checked })}
            label={<span class="pk-sr-only">{`${tier.tier} active`}</span>}
          />
        ) : tier.active ? (
          "Yes"
        ) : (
          "No"
        ),
    },
    ...(canWrite
      ? [
          {
            id: "actions",
            header: "Actions",
            headerHidden: true,
            align: "end" as const,
            cell: (tier: SponsorshipTierConfig) =>
              editingId === tier.id ? (
                <div class="pk-cluster">
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      setEditingId(null);
                      setError(null);
                      form.reset();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    form={formIdFor(tier)}
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={saving}
                    disabled={saving}
                  >
                    Save
                  </Button>
                </div>
              ) : (
                <Menu
                  label={`${statusLabel(tier.sponsorType)} ${tier.tier} pricing actions`}
                  align="end"
                  items={[
                    {
                      id: "edit",
                      label: "Edit pricing",
                      disabled: saving || editingId !== null,
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
    <div class="pk" {...form.handlers}>
      <Panel aria-label="Sponsorship tier pricing">
        <PanelHeader title="Sponsorship tier pricing" />
        <PanelBody>
          {loading && <Spinner />}
          {!loading && error && <ErrorAlert error={error} />}
          {!loading && (!error || tiers.length > 0) && (
            <DataTable
              caption="Sponsorship tier pricing"
              columns={columns}
              rows={tiers}
              rowKey={(tier) => tier.id}
              empty={<EmptyState title="No tier pricing is configured." />}
            />
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
