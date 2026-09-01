import { useEffect, useState } from "preact/hooks";
import {
  GROUP_AUTOMATIC_ENROLLMENT_MODES,
  GROUP_ELIGIBILITY_MODES,
  GROUP_GOVERNANCE_INHERITANCE_MODES,
  GROUP_VISIBILITIES,
  groupResponseSchema,
  groupUpdateSchema,
  type GroupSettingsDetail,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { ApiClientError, patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";

interface GroupSettingsDraft {
  name: string;
  description: string;
  links: string[];
  visibility: GroupSettingsDetail["visibility"];
  governanceInheritanceMode: GroupSettingsDetail["governanceInheritanceMode"];
  eligibilityMode: GroupSettingsDetail["eligibilityMode"];
  automaticEnrollmentMode: GroupSettingsDetail["automaticEnrollmentMode"];
  allowAutomaticOptOut: boolean;
  publicLeadership: boolean;
  minEndorsersForBallot: number;
  active: boolean;
}

function draftFromGroup(group: GroupSettingsDetail): GroupSettingsDraft {
  return {
    name: group.name,
    description: group.description ?? "",
    links: group.links,
    visibility: group.visibility,
    governanceInheritanceMode: group.governanceInheritanceMode,
    eligibilityMode: group.eligibilityMode,
    automaticEnrollmentMode: group.automaticEnrollmentMode,
    allowAutomaticOptOut: group.allowAutomaticOptOut,
    publicLeadership: group.publicLeadership,
    minEndorsersForBallot: group.minEndorsersForBallot,
    active: group.active,
  };
}

function optionLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function GroupSettingsForm({
  group,
  onUpdated,
}: {
  group: GroupSettingsDetail;
  onUpdated: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftFromGroup(group));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(draftFromGroup(group));
    setError(null);
  }, [group.id, group.revision]);

  useEffect(() => setSaved(false), [group.id]);

  function setField<Key extends keyof GroupSettingsDraft>(key: Key, value: GroupSettingsDraft[Key]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    // The submit control stays focusable while it saves, so it also stays
    // clickable; the guard is what stops a second in-flight request.
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const changes = groupUpdateSchema.parse({
        expectedRevision: group.revision,
        name: draft.name,
        description: draft.description.trim() || null,
        links: draft.links,
        visibility: draft.visibility,
        governanceInheritanceMode: draft.governanceInheritanceMode,
        eligibilityMode: draft.eligibilityMode,
        automaticEnrollmentMode: draft.automaticEnrollmentMode,
        allowAutomaticOptOut: draft.allowAutomaticOptOut,
        publicLeadership: draft.publicLeadership,
        minEndorsersForBallot: draft.minEndorsersForBallot,
        active: draft.active,
      });
      await patchJson(`/api/v1/groups/${encodeURIComponent(group.id)}`, changes, groupResponseSchema);
      await onUpdated();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not update this group.");
    } finally {
      setSaving(false);
    }
  }

  const optOutUnavailable = draft.automaticEnrollmentMode === "none";

  return (
    <form class="pk" onSubmit={(event) => void submit(event)}>
      <Panel>
        <PanelHeader title="Group settings" />
        <PanelBody class="pk-stack">
          {/* One attribute takes the whole form out of play while it saves,
              including the link editor's own controls, which take no prop for
              it. The submit button stays outside so it keeps focus. */}
          <fieldset class="pk-fieldset pk-stack" disabled={saving}>
            <Field label="Name" required>
              {(control) => (
                <TextInput
                  {...control}
                  value={draft.name}
                  onInput={(event) => setField("name", (event.target as HTMLInputElement).value)}
                />
              )}
            </Field>

            <Field label="Description">
              {(control) => (
                <Textarea
                  {...control}
                  rows={4}
                  value={draft.description}
                  onInput={(event) => setField("description", (event.target as HTMLTextAreaElement).value)}
                />
              )}
            </Field>

            {/* The link editor is several controls, not one, so the group is
                named by a legend rather than by a label with nothing to point
                at. Its own input keeps its own accessible name. */}
            <fieldset class="pk-fieldset pk-stack pk-stack--tight">
              <legend class="pk-field__label">Links</legend>
              <ProfileLinksInput
                fieldName="group.links"
                value={draft.links}
                onChange={(links) => setField("links", links)}
                helpText="Add any relevant group resources, such as a website, repository, document library, or meeting page."
                inputAriaLabel="Group resource URL"
              />
            </fieldset>

            <div class="pk-grid pk-grid--roomy">
              <Field label="Visibility">
                {(control) => (
                  <Select
                    {...control}
                    value={draft.visibility}
                    onChange={(event) =>
                      setField(
                        "visibility",
                        (event.target as HTMLSelectElement).value as GroupSettingsDetail["visibility"],
                      )
                    }
                  >
                    {GROUP_VISIBILITIES.map((value) => (
                      <option key={value} value={value}>
                        {optionLabel(value)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Leadership inheritance">
                {(control) => (
                  <Select
                    {...control}
                    value={draft.governanceInheritanceMode}
                    onChange={(event) =>
                      setField(
                        "governanceInheritanceMode",
                        (event.target as HTMLSelectElement).value as GroupSettingsDetail["governanceInheritanceMode"],
                      )
                    }
                  >
                    {GROUP_GOVERNANCE_INHERITANCE_MODES.map((value) => (
                      <option key={value} value={value}>
                        {optionLabel(value)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Join eligibility">
                {(control) => (
                  <Select
                    {...control}
                    value={draft.eligibilityMode}
                    onChange={(event) =>
                      setField(
                        "eligibilityMode",
                        (event.target as HTMLSelectElement).value as GroupSettingsDetail["eligibilityMode"],
                      )
                    }
                  >
                    {GROUP_ELIGIBILITY_MODES.map((value) => (
                      <option key={value} value={value}>
                        {optionLabel(value)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Automatic enrollment">
                {(control) => (
                  <Select
                    {...control}
                    value={draft.automaticEnrollmentMode}
                    onChange={(event) => {
                      const value = (event.target as HTMLSelectElement)
                        .value as GroupSettingsDetail["automaticEnrollmentMode"];
                      setDraft((current) => ({
                        ...current,
                        automaticEnrollmentMode: value,
                        allowAutomaticOptOut: value === "none" ? false : current.allowAutomaticOptOut,
                      }));
                    }}
                  >
                    {GROUP_AUTOMATIC_ENROLLMENT_MODES.map((value) => (
                      <option key={value} value={value}>
                        {optionLabel(value)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Minimum endorsers for a ballot">
                {(control) => (
                  <TextInput
                    {...control}
                    type="number"
                    min={0}
                    max={1000}
                    value={draft.minEndorsersForBallot}
                    onInput={(event) =>
                      setField("minEndorsersForBallot", (event.target as HTMLInputElement).valueAsNumber)
                    }
                  />
                )}
              </Field>
            </div>

            <div class="pk-stack pk-stack--snug">
              <label class="pk-check">
                <input
                  class="pk-check__input"
                  type="checkbox"
                  checked={draft.allowAutomaticOptOut}
                  disabled={optOutUnavailable}
                  onChange={(event) => setField("allowAutomaticOptOut", (event.target as HTMLInputElement).checked)}
                />
                <span class="pk-check__label">
                  Allow people to opt out of automatic enrollment
                  {/* The control is dimmed when it does not apply; the reason
                      is stated in words so the state is not carried by the
                      dimming alone. */}
                  {optOutUnavailable && (
                    <span class="pk-check__hint">
                      Available once automatic enrollment is set to something other than “None”.
                    </span>
                  )}
                </span>
              </label>

              <label class="pk-check">
                <input
                  class="pk-check__input"
                  type="checkbox"
                  checked={draft.publicLeadership}
                  onChange={(event) => setField("publicLeadership", (event.target as HTMLInputElement).checked)}
                />
                <span class="pk-check__label">Publish leadership</span>
              </label>

              <label class="pk-check">
                <input
                  class="pk-check__input"
                  type="checkbox"
                  checked={draft.active}
                  onChange={(event) => setField("active", (event.target as HTMLInputElement).checked)}
                />
                <span class="pk-check__label">Active</span>
              </label>
            </div>
          </fieldset>

          {error && <ErrorAlert error={error} />}
          {saved && <Alert tone="ok">Group settings updated.</Alert>}

          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={saving} disabled={!draft.name.trim()}>
              {saving ? "Saving…" : "Save group settings"}
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </form>
  );
}
