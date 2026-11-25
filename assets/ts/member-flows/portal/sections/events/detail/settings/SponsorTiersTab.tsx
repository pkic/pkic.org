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
  const resource = useEditorResource(async () => await getJson(endpoint, eventSponsorTiersResponseSchema), [endpoint], {
    tiers: [],
    consortiumTiers: [],
  });
  const { value: settings, setValue: setSettings, loading, error } = resource;
  const { tiers, consortiumTiers } = settings;
  const setTiers = (update: (current: typeof tiers) => typeof tiers) =>
    setSettings((current) => ({ ...current, tiers: update(current.tiers) }));
  const [editing, setEditing] = useState(false);
  const [savedSettings, setSavedSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const consortiumLeadTiers = consortiumTiers.filter((tier) => tier.capturesLeads).map((tier) => tier.tier);
  const form = useContractForm(eventSponsorTiersReplaceSchema, { tiers, consortiumLeadTiers });
  useEffect(() => {
    if (!editing && !loading) setSavedSettings(settings);
  }, [settings, editing, loading]);
  function reset() {
    setSettings(savedSettings);
    form.reset();
    setFailure("");
    setSaved(false);
  }
  async function save(event: Event) {
    event.preventDefault();
    if (!canWrite || !editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setFailure(checked.formMessage ?? "");
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      // The save returns the stored settings, so the tab shows them without another read.
      setSettings(await putJson(endpoint, checked.data, eventSponsorTiersResponseSchema));
      setEditing(false);
      setSaved(true);
    } catch (cause) {
      setFailure(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      noValidate
      {...form.handlers}
      onSubmit={(event) => {
        void save(event).catch((error: unknown) => setFailure(form.refuse(error)));
      }}
    >
      <SettingsEditor
        loading={loading}
        error={error}
        description="Choose which sponsor tiers can access attendee data, and which consortium tiers can scan leads at this event."
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
                    {/* Removal only edits the draft; nothing is persisted until Save, so it needs no confirmation. */}
                    <Button
                      variant="danger-quiet"
                      onClick={() => setTiers((current) => current.filter((_, position) => position !== index))}
                    >
                      Remove tier {index + 1}
                    </Button>
                  </div>
                </fieldset>
              ))}
              <div class="pk-cluster">
                <Button
                  disabled={saving}
                  onClick={() => setTiers((current) => [...current, { tierName: "", hasAttendeeDataAccess: false }])}
                >
                  + Add tier
                </Button>
              </div>
              {consortiumTiers.length > 0 && (
                <Field
                  {...form.of("consortiumLeadTiers")}
                  label="Consortium lead scanning"
                  help="PKI Consortium sponsors in the selected tiers can scan badges to collect leads at this event."
                  group
                >
                  {(control) => (
                    <div class="pk-cluster" aria-describedby={control["aria-describedby"]}>
                      {consortiumTiers.map((tier) => (
                        <Checkbox
                          key={tier.tier}
                          name="consortiumLeadTiers"
                          value={tier.tier}
                          checked={tier.capturesLeads}
                          disabled={saving}
                          label={tier.tier}
                          onChange={(event) => {
                            const capturesLeads = event.currentTarget.checked;
                            setSettings((current) => ({
                              ...current,
                              consortiumTiers: current.consortiumTiers.map((item) =>
                                item.tier === tier.tier ? { ...item, capturesLeads } : item,
                              ),
                            }));
                          }}
                        />
                      ))}
                    </div>
                  )}
                </Field>
              )}
            </>
          ) : (
            <>
              {tiers.length ? (
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
              {consortiumTiers.length > 0 && (
                <DescriptionList
                  items={[
                    {
                      term: "Consortium lead scanning",
                      value: consortiumLeadTiers.length ? consortiumLeadTiers.join(", ") : "No consortium tiers",
                    },
                  ]}
                />
              )}
            </>
          )}
        </div>
      </SettingsEditor>
    </form>
  );
}
