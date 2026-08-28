import { useState } from "preact/hooks";
import { api } from "../../../../api";
import { eventSponsorTiersResponseSchema } from "../../../../../../shared/schemas/sponsorship-management";
import { useAdminEditorResource } from "../../../../hooks/useAdminEditorResource";
import { saveAdminEditor } from "../../../../actions";
import { AdminSettingsEditor } from "../../../../components/AdminSettingsEditor";

export function SponsorTiersTab({ slug }: { slug: string }) {
  const tiersResource = useAdminEditorResource(
    async () => {
      const data = await api(`/api/v1/events/${slug}/sponsor-tiers`, eventSponsorTiersResponseSchema);
      return data.tiers ?? [];
    },
    [slug],
    [],
  );
  const { value: tiers, setValue: setTiers, loading, error, reload } = tiersResource;
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  async function handleSave() {
    await saveAdminEditor({
      setSaving,
      setStatus: setSaveStatus,
      request: () =>
        api(`/api/v1/events/${slug}/sponsor-tiers`, eventSponsorTiersResponseSchema, {
          method: "PUT",
          body: JSON.stringify({ tiers: tiers.filter((tier) => tier.tierName.trim()) }),
        }),
      successMessage: "Sponsor tiers updated",
      reload,
    });
  }

  return (
    <AdminSettingsEditor
      loading={loading}
      error={error}
      description="Which sponsor tiers at this event get attendee-data access via the sponsor portal. Defaults to no tiers having access."
      actions={
        <button class="btn btn-sm btn-primary ms-auto" onClick={() => void handleSave()} disabled={saving}>
          Save
        </button>
      }
    >
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
    </AdminSettingsEditor>
  );
}
