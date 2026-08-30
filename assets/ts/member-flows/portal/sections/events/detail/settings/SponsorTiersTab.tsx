import { useState } from "preact/hooks";
import { getJson, putJson } from "../../../../../../shared/api-client";
import { eventSponsorTiersResponseSchema } from "../../../../../../../shared/schemas/sponsorship-management";
import { useEditorResource } from "../../../../../../hooks/useEditorResource";
import { saveEditor } from "../../../../actions";
import { SettingsEditor } from "./SettingsEditor";

export function SponsorTiersTab({ slug, canWrite }: { slug: string; canWrite: boolean }) {
  const tiersResource = useEditorResource(
    async () => {
      const data = await getJson(`/api/v1/events/${slug}/sponsors/tiers`, eventSponsorTiersResponseSchema);
      return data.tiers ?? [];
    },
    [slug],
    [],
  );
  const { value: tiers, setValue: setTiers, loading, error, reload } = tiersResource;
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  async function handleSave() {
    await saveEditor({
      setSaving,
      setStatus: setSaveStatus,
      request: () =>
        putJson(
          `/api/v1/events/${slug}/sponsors/tiers`,
          { tiers: tiers.filter((tier) => tier.tierName.trim()) },
          eventSponsorTiersResponseSchema,
        ),
      successMessage: "Sponsor tiers updated",
      reload,
    });
  }

  return (
    <SettingsEditor
      loading={loading}
      error={error}
      description="Which sponsor tiers at this event get attendee-data access in the portal. Defaults to no tiers having access."
      actions={
        canWrite ? (
          <button class="btn btn-sm btn-primary ms-auto" onClick={() => void handleSave()} disabled={saving}>
            Save
          </button>
        ) : undefined
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
              disabled={!canWrite}
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
                disabled={!canWrite}
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
          {canWrite && (
            <div class="col-sm-2">
              <button
                type="button"
                class="btn btn-sm btn-outline-danger"
                onClick={() => setTiers((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ))}
      {canWrite && (
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          onClick={() => setTiers((current) => [...current, { tierName: "", hasAttendeeDataAccess: false }])}
        >
          + Add tier
        </button>
      )}
    </SettingsEditor>
  );
}
