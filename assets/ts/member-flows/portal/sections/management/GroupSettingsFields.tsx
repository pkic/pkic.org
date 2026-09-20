import { useId } from "preact/hooks";
import {
  GROUP_AUTOMATIC_ENROLLMENT_MODES,
  GROUP_ELIGIBILITY_MODES,
  GROUP_GOVERNANCE_INHERITANCE_MODES,
  GROUP_VISIBILITIES,
  type GroupSettingsDetail,
} from "../../../../../shared/schemas/groups";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";

import type { FieldPresentation } from "../../../../hooks/useContractForm";
import { optionLabel, type GroupSettingsDraft } from "./group-settings-draft";
import { MarkdownEditor } from "../../../../components/markdown-editor/MarkdownInput";

export function GroupSettingsFields({
  draft,
  saving,
  setDraft,
  fields,
}: {
  draft: GroupSettingsDraft;
  saving: boolean;
  setDraft: (update: (current: GroupSettingsDraft) => GroupSettingsDraft) => void;
  fields: (name: string) => FieldPresentation;
}) {
  function setField<Key extends keyof GroupSettingsDraft>(key: Key, value: GroupSettingsDraft[Key]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  const enabledId = useId();
  const optOutUnavailable = draft.automaticEnrollmentMode === "none";
  return (
    <fieldset class="pk-fieldset pk-stack" disabled={saving}>
      <Field {...fields("name")} label="Name" required>
        {(control) => (
          <TextInput
            {...control}
            name="name"
            value={draft.name}
            onInput={(event) => setField("name", (event.target as HTMLInputElement).value)}
          />
        )}
      </Field>

      <Field {...fields("description")} label="Description">
        {(control) => (
          <MarkdownEditor
            variant="compact"
            {...control}
            name="description"
            label="Description"
            initialValue={draft.description}
            onChange={(value) => setField("description", value)}
          />
        )}
      </Field>

      {/* The link editor is several controls, not one, so the group is
                named by a legend rather than by a label with nothing to point
                at. Its own input keeps its own accessible name. */}
      <fieldset class="pk-fieldset pk-field">
        <legend class="pk-field__label">Links</legend>
        <ProfileLinksInput
          fieldName="links"
          value={draft.links}
          onChange={(links) => setField("links", links)}
          helpText="Add any relevant group resources, such as a website, repository, document library, or meeting page."
          inputAriaLabel="Group resource URL"
        />
      </fieldset>

      <div class="pk-grid pk-grid--roomy">
        <Field {...fields("visibility")} label="Visibility">
          {(control) => (
            <Select
              {...control}
              name="visibility"
              value={draft.visibility}
              onChange={(event) =>
                setField("visibility", (event.target as HTMLSelectElement).value as GroupSettingsDetail["visibility"])
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

        <Field {...fields("governanceInheritanceMode")} label="Leadership inheritance">
          {(control) => (
            <Select
              {...control}
              name="governanceInheritanceMode"
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

        <Field {...fields("eligibilityMode")} label="Join eligibility">
          {(control) => (
            <Select
              {...control}
              name="eligibilityMode"
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

        <Field {...fields("automaticEnrollmentMode")} label="Automatic enrollment">
          {(control) => (
            <Select
              {...control}
              name="automaticEnrollmentMode"
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

        <Field {...fields("minEndorsersForBallot")} label="Minimum endorsers for a ballot">
          {(control) => (
            <TextInput
              {...control}
              name="minEndorsersForBallot"
              type="number"
              min={0}
              max={1000}
              value={draft.minEndorsersForBallot}
              onInput={(event) => setField("minEndorsersForBallot", (event.target as HTMLInputElement).valueAsNumber)}
            />
          )}
        </Field>
      </div>

      <div class="pk-stack pk-stack--snug">
        {/* The control is dimmed when it does not apply; the reason is
                  stated in words so the state is not carried by the dimming
                  alone. */}
        <Checkbox
          checked={draft.allowAutomaticOptOut}
          disabled={optOutUnavailable}
          onChange={(event) => setField("allowAutomaticOptOut", (event.target as HTMLInputElement).checked)}
          label="Allow people to opt out of automatic enrollment"
          hint={
            optOutUnavailable ? "Available once automatic enrollment is set to something other than “None”." : undefined
          }
        />

        <Checkbox
          checked={draft.publicLeadership}
          onChange={(event) => setField("publicLeadership", (event.target as HTMLInputElement).checked)}
          label="Publish leadership on the public site"
        />

        <Checkbox
          checked={draft.publicRoster}
          onChange={(event) => setField("publicRoster", (event.target as HTMLInputElement).checked)}
          label="Publish the member roster and its history on the public site"
        />

        <Checkbox
          checked={draft.active}
          onChange={(event) => setField("active", (event.target as HTMLInputElement).checked)}
          label={<span id={`${enabledId}-label`}>Group enabled</span>}
          aria-labelledby={`${enabledId}-label`}
          aria-describedby={`${enabledId}-help`}
          hint={
            <span id={`${enabledId}-help`}>
              Disabling prevents users from joining or accessing the group as participants, stops automatic enrollment,
              and ends automatically enrolled memberships. The group and its history are kept.
            </span>
          }
        />
      </div>
    </fieldset>
  );
}
