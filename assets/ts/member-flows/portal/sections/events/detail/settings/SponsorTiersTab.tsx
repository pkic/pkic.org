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
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import { Menu } from "../../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { FormActions } from "../../../../../../components/FormActions";
import { Spinner } from "../../../../../../components/Spinner";
import { EventSponsorsPanel } from "./sponsors/EventSponsorsPanel";

/**
 * The event's sponsor tiers: which may read attendee data, and which consortium tiers scan leads. With the event
 * known, they sit under its sponsor list and are edited from that panel's menu.
 */
export function SponsorTiersTab({
  slug,
  canWrite,
  eventId,
  endpoint = "/api/v1/events/" + encodeURIComponent(slug) + "/sponsors/tiers",
}: {
  slug: string;
  canWrite: boolean;
  eventId?: string;
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
  const menu =
    canWrite && !editing && !loading && !error ? (
      <Menu
        label="Event sponsor actions"
        align="end"
        items={[
          {
            id: "edit-tiers",
            label: "Edit sponsor tiers",
            onSelect: () => {
              reset();
              setEditing(true);
            },
          },
        ]}
      />
    ) : undefined;
  const tierSettings = (
    <PanelBody>
      <div class="pk-stack">
        <SectionHeading level={4}>Sponsor tiers</SectionHeading>
        {loading ? (
          <Spinner label="Loading sponsor tiers…" />
        ) : error ? (
          <ErrorAlert error={error} />
        ) : (
          <form
            noValidate
            class="pk-stack"
            {...form.handlers}
            onSubmit={(event) => {
              void save(event).catch((cause: unknown) => setFailure(form.refuse(cause)));
            }}
          >
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
                              position === index
                                ? { ...item, hasAttendeeDataAccess: event.currentTarget.checked }
                                : item,
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
            {editing && (
              <FormActions
                submitLabel="Save sponsor tiers"
                busyLabel="Saving…"
                busy={saving}
                onCancel={() => {
                  reset();
                  setEditing(false);
                }}
              />
            )}
          </form>
        )}
      </div>
    </PanelBody>
  );
  return eventId ? (
    <EventSponsorsPanel eventId={eventId} canWrite={canWrite} menu={menu}>
      {tierSettings}
    </EventSponsorsPanel>
  ) : (
    <Panel aria-label="Sponsor tiers">
      <PanelHeader title="Sponsor tiers" menu={menu} />
      {tierSettings}
    </Panel>
  );
}
