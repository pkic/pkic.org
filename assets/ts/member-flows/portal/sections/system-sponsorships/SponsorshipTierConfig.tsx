import { useEffect, useState } from "preact/hooks";
import {
  sponsorshipTierConfigListResponseSchema,
  sponsorshipTierConfigResponseSchema,
  sponsorshipTierConfigUpdateSchema,
  type SponsorshipTierConfig,
} from "../../../../../shared/schemas/sponsorship-management";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { getJson, patchJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

const TIER_CONFIG_ENDPOINT = "/api/v1/sponsorships/tier-config";

export function SponsorshipTierConfig({ canWrite }: { canWrite: boolean }) {
  const [tiers, setTiers] = useState<SponsorshipTierConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(TIER_CONFIG_ENDPOINT, sponsorshipTierConfigListResponseSchema);
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

  return (
    <section class="card border-0 shadow-sm mb-3" aria-labelledby="sponsorship-tier-config-heading">
      <div class="card-header bg-white fw-semibold" id="sponsorship-tier-config-heading">
        Sponsorship tier pricing
      </div>
      <div class="card-body">
        {loading && <Spinner />}
        {!loading && error && <ErrorAlert error={error} />}
        {!loading && !error && tiers.length === 0 && <p class="text-muted mb-0">No tier pricing is configured.</p>}
        {!loading && !error && tiers.length > 0 && (
          <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Amount (cents)</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Active</th>
                  {canWrite && (
                    <th scope="col">
                      <span class="visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier) => (
                  <tr key={tier.id}>
                    <td class="text-capitalize">{tier.sponsorType}</td>
                    <td>{tier.tier}</td>
                    <td colSpan={canWrite ? 1 : 1}>
                      {canWrite ? (
                        <form id={`sponsorship-tier-${tier.id}`} onSubmit={(event) => void save(tier, event)}>
                          <input
                            name="amountCents"
                            type="number"
                            min="0"
                            class="form-control form-control-sm"
                            defaultValue={tier.amountCents}
                            aria-label={`${tier.tier} amount in cents`}
                          />
                        </form>
                      ) : (
                        tier.amountCents
                      )}
                    </td>
                    <td>
                      {canWrite ? (
                        <input
                          form={`sponsorship-tier-${tier.id}`}
                          name="currency"
                          class="form-control form-control-sm"
                          defaultValue={tier.currency}
                          maxLength={3}
                          aria-label={`${tier.tier} currency`}
                        />
                      ) : (
                        tier.currency
                      )}
                    </td>
                    <td>
                      {canWrite ? (
                        <input
                          form={`sponsorship-tier-${tier.id}`}
                          name="active"
                          type="checkbox"
                          class="form-check-input"
                          defaultChecked={tier.active}
                          aria-label={`${tier.tier} active`}
                        />
                      ) : tier.active ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <button
                          form={`sponsorship-tier-${tier.id}`}
                          type="submit"
                          class="btn btn-sm btn-outline-primary"
                        >
                          Save
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
