import { useState } from "preact/hooks";
import { getJson, putJson } from "../../../../../../shared/api-client";
import { eventSponsorTiersResponseSchema } from "../../../../../../../shared/schemas/sponsorship-management";
import { useEditorResource } from "../../../../../../hooks/useEditorResource";
import { Alert, type AlertTone } from "../../../../../../ui/Alert";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { saveEditor } from "../../../../actions";
import { SettingsEditor } from "./SettingsEditor";

/**
 * The tone the save outcome is reported in.
 *
 * It used to be `text-success` for a tick and `text-warning` for everything
 * else, which made "Saving…" look like a problem and a real failure look like
 * the same mild caution. Each of the three outcomes gets the tone it actually
 * is, and the words say which it is either way.
 */
function statusTone(status: string): AlertTone {
  if (status.startsWith("✓")) return "ok";
  if (status === "Saving…") return "info";
  return "danger";
}

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
          // `pk-push` fills the remaining space in the flex bar the editor
          // lays out, which is what `ms-auto` was doing.
          <Button
            class="pk-push"
            size="sm"
            variant="primary"
            loading={saving}
            disabled={saving}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        ) : undefined
      }
    >
      <div class="pk pk-stack">
        {saveStatus && <Alert tone={statusTone(saveStatus)}>{saveStatus}</Alert>}

        {tiers.map((tier, index) => (
          // Each row is a named group, so the two controls inside it do not
          // have to repeat "tier 3" in their own names to be told apart. The
          // name input used to have no label at all — only a placeholder,
          // which disappears the moment anything is typed into it.
          //
          // `disabled` on the fieldset takes the whole row out of play in one
          // attribute, including the controls rendered by a child component.
          <fieldset class="pk-fieldset pk-field" key={`${tier.tierName}-${index}`} disabled={!canWrite}>
            <legend class="pk-field__label">Tier {index + 1}</legend>
            <div class="pk-cluster">
              <Field label="Tier name">
                {(control) => (
                  <TextInput
                    {...control}
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
                )}
              </Field>
              <label class="pk-check">
                <input
                  class="pk-check__input"
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
                />
                <span class="pk-check__label">Attendee data access</span>
              </label>
              {canWrite && (
                <Button
                  variant="danger-quiet"
                  size="sm"
                  aria-label={`Remove tier ${String(index + 1)}`}
                  onClick={() => setTiers((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Remove
                </Button>
              )}
            </div>
          </fieldset>
        ))}
        {canWrite && (
          <div class="pk-cluster">
            <Button
              size="sm"
              onClick={() => setTiers((current) => [...current, { tierName: "", hasAttendeeDataAccess: false }])}
            >
              + Add tier
            </Button>
          </div>
        )}
      </div>
    </SettingsEditor>
  );
}
