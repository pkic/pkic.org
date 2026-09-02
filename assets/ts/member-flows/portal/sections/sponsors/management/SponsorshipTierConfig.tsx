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
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const parsed = sponsorshipTierConfigUpdateSchema.safeParse({
      amountCents: Number(form.get("amountCents")),
      currency: String(form.get("currency") ?? ""),
      active: form.get("active") === "on",
    });
    if (!parsed.success) {
      toast("Enter a valid amount and three-letter currency.", "error");
      return;
    }
    try {
      await patchJson(
        `${TIER_CONFIG_ENDPOINT}/${encodeURIComponent(tier.id)}`,
        parsed.data,
        sponsorshipTierConfigResponseSchema,
      );
      toast(`${tier.sponsorType} ${tier.tier} saved`, "success");
      await load();
    } catch (cause) {
      toast((cause as Error).message, "error");
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
        canWrite ? (
          <form id={formIdFor(tier)} onSubmit={(event) => void save(tier, event)}>
            <TextInput
              name="amountCents"
              type="number"
              min="0"
              defaultValue={tier.amountCents}
              aria-label={`${tier.tier} amount in cents`}
            />
          </form>
        ) : (
          tier.amountCents
        ),
    },
    {
      id: "currency",
      header: "Currency",
      cell: (tier) =>
        canWrite ? (
          <TextInput
            form={formIdFor(tier)}
            name="currency"
            defaultValue={tier.currency}
            maxLength={3}
            aria-label={`${tier.tier} currency`}
          />
        ) : (
          tier.currency
        ),
    },
    {
      id: "active",
      header: "Active",
      cell: (tier) =>
        canWrite ? (
          /*
           * The name comes from real label text rather than an `aria-label`,
           * so it survives translation and matches what a speech-input user
           * would say; the text is hidden because the column header already
           * carries it visually.
           */
          <Checkbox
            form={formIdFor(tier)}
            name="active"
            defaultChecked={tier.active}
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
            cell: (tier: SponsorshipTierConfig) => (
              <Button form={formIdFor(tier)} type="submit" variant="secondary" size="sm">
                Save
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div class="pk">
      <Panel aria-label="Sponsorship tier pricing">
        <PanelHeader title="Sponsorship tier pricing" />
        <PanelBody>
          {loading && <Spinner />}
          {!loading && error && <ErrorAlert error={error} />}
          {!loading && !error && (
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
