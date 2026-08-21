import { useCallback, useEffect, useState } from "preact/hooks";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../components/Spinner";
import { api } from "../../../../api";
import { toast } from "../../../../ui";

interface SponsorTierState {
  tierName: string;
  hasAttendeeDataAccess: boolean;
}

export function SponsorTiersTab({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<SponsorTierState[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ tiers: SponsorTierState[] }>(`/api/v1/admin/events/${slug}/sponsor-tiers`);
      setTiers(data.tiers ?? []);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    setSaveStatus("Saving…");
    try {
      await api(`/api/v1/admin/events/${slug}/sponsor-tiers`, {
        method: "PUT",
        body: JSON.stringify({ tiers: tiers.filter((tier) => tier.tierName.trim()) }),
      });
      setSaveStatus("✓ Saved");
      toast("Sponsor tiers updated", "success");
      await load();
    } catch (caught) {
      const message = (caught as Error).message;
      setSaveStatus(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div>
      <div class="d-flex gap-2 align-items-center mb-3 flex-wrap">
        <span class="small text-muted">
          Which sponsor tiers at this event get attendee-data access via the sponsor portal. Defaults to no tiers having
          access.
        </span>
        <button class="btn btn-sm btn-primary ms-auto" onClick={() => void handleSave()} disabled={saving}>
          Save
        </button>
      </div>
      {saveStatus && (
        <div class={`small mb-2 ${saveStatus.startsWith("✓") ? "text-success" : "text-warning"}`}>{saveStatus}</div>
      )}

      {tiers.map((tier, index) => (
        <div class="row g-2 align-items-center mb-2" key={`${tier.tierName}-${index}`}>
          <div class="col-sm-4">
            <input
              class="form-control form-control-sm"
              placeholder="e.g. Leader"
              value={tier.tierName}
              onInput={(event) =>
                setTiers((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, tierName: (event.target as HTMLInputElement).value } : item,
                  ),
                )
              }
            />
          </div>
          <div class="col-sm-4">
            <div class="form-check">
              <input
                class="form-check-input"
                type="checkbox"
                checked={tier.hasAttendeeDataAccess}
                onChange={(event) =>
                  setTiers((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, hasAttendeeDataAccess: (event.target as HTMLInputElement).checked }
                        : item,
                    ),
                  )
                }
                id={`sponsor-tier-access-${index}`}
              />
              <label class="form-check-label small" for={`sponsor-tier-access-${index}`}>
                Attendee data access
              </label>
            </div>
          </div>
          <div class="col-sm-2">
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              onClick={() => setTiers((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        onClick={() => setTiers((current) => [...current, { tierName: "", hasAttendeeDataAccess: false }])}
      >
        + Add tier
      </button>
    </div>
  );
}
