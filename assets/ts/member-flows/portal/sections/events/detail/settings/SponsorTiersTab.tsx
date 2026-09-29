import { useState, useEffect } from "preact/hooks";
import { getJson, putJson } from "../../../../../../shared/api-client";
import {
  eventSponsorTiersResponseSchema,
  eventSponsorTiersReplaceSchema,
} from "../../../../../../../shared/schemas/sponsorship-management";
import { useEditorResource } from "../../../../../../hooks/useEditorResource";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../ui/EditActions";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { SettingsEditor } from "./SettingsEditor";

export function SponsorTiersTab({
  slug,
  canWrite,
  endpoint = "/api/v1/events/" + encodeURIComponent(slug) + "/sponsors/tiers",
}: {
  slug: string;
  canWrite: boolean;
  endpoint?: string;
}) {
  const resource = useEditorResource(
    async () => (await getJson(endpoint, eventSponsorTiersResponseSchema)).tiers,
    [endpoint],
    [],
  );
  const { value: tiers, setValue: setTiers, loading, error, reload } = resource;
  const [editing, setEditing] = useState(false);
  const [savedTiers, setSavedTiers] = useState(tiers);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const form = useContractForm(eventSponsorTiersReplaceSchema, { tiers });
  useEffect(() => {
    if (!editing && !loading) setSavedTiers(tiers);
  }, [tiers, editing, loading]);
  function reset() {
    setTiers(savedTiers);
    form.reset();
    setFailure("");
    setSaved(false);
  }
  async function save(event: Event) {
    event.preventDefault();
    if (!canWrite || !editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setFailure(checked.message);
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      await putJson(endpoint, checked.data, eventSponsorTiersResponseSchema);
      await reload();
      setEditing(false);
      setSaved(true);
    } catch (cause) {
      setFailure(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form noValidate {...form.handlers} onSubmit={save}>
      <SettingsEditor
        loading={loading}
        error={error}
        description="Choose which sponsor tiers can access attendee data for this event."
        actions={
          canWrite ? (
            <EditActions
              label="Sponsor tier actions"
              editing={editing}
              saving={saving}
              saveLabel="Save sponsor tiers"
              onEdit={() => {
                reset();
                setEditing(true);
              }}
              onCancel={() => {
                reset();
                setEditing(false);
              }}
            />
          ) : undefined
        }
      >
        <div class="pk pk-stack">
          {failure && <Alert tone="danger">{failure}</Alert>}
          {saved && <Alert tone="ok">Sponsor tiers updated.</Alert>}
          {editing ? (
            <>
              {tiers.map((tier, index) => (
                <fieldset class="pk-fieldset pk-field" key={index} disabled={saving}>
                  <legend class="pk-field__label">Tier {index + 1}</legend>
                  <div class="pk-cluster">
                    <Field label="Tier name" {...form.of(`tiers.${index}.tierName`)}>
                      {(control) => (
                        <TextInput
                          {...control}
                          name={`tiers.${index}.tierName`}
                          placeholder="e.g. Leader"
                          value={tier.tierName}
                          onInput={(event) =>
                            setTiers((current) =>
                              current.map((item, position) =>
                                position === index ? { ...item, tierName: event.currentTarget.value } : item,
                              ),
                            )
                          }
                        />
                      )}
                    </Field>
                    <Checkbox
                      name={`tiers.${index}.hasAttendeeDataAccess`}
                      checked={tier.hasAttendeeDataAccess}
                      label="Attendee data access"
                      onChange={(event) =>
                        setTiers((current) =>
                          current.map((item, position) =>
                            position === index ? { ...item, hasAttendeeDataAccess: event.currentTarget.checked } : item,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="danger-quiet"
                      size="sm"
                      aria-label={`Remove tier ${index + 1}`}
                      onClick={() => setTiers((current) => current.filter((_, position) => position !== index))}
                    >
                      Remove
                    </Button>
                  </div>
                </fieldset>
              ))}
              <div class="pk-cluster">
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={() => setTiers((current) => [...current, { tierName: "", hasAttendeeDataAccess: false }])}
                >
                  + Add tier
                </Button>
              </div>
            </>
          ) : tiers.length ? (
            <DescriptionList
              items={tiers.map((tier) => ({
                term: tier.tierName,
                value: tier.hasAttendeeDataAccess ? "Attendee data access enabled" : "No attendee data access",
              }))}
            />
          ) : (
            <p class="pk-muted">
              No sponsor tiers have been configured. Attendee data access is disabled for every tier.
            </p>
          )}
        </div>
      </SettingsEditor>
    </form>
  );
}
