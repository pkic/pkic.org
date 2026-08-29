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

  return (
    <form class="card border-0 shadow-sm" onSubmit={submit}>
      <div class="card-header bg-white fw-semibold">Group settings</div>
      <div class="card-body d-flex flex-column gap-3">
        <div>
          <label class="form-label small fw-semibold" for="managed-group-name">
            Name
          </label>
          <input
            id="managed-group-name"
            class="form-control"
            value={draft.name}
            disabled={saving}
            required
            onInput={(event) => setField("name", (event.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label class="form-label small fw-semibold" for="managed-group-description">
            Description
          </label>
          <textarea
            id="managed-group-description"
            class="form-control"
            rows={4}
            value={draft.description}
            disabled={saving}
            onInput={(event) => setField("description", (event.target as HTMLTextAreaElement).value)}
          />
        </div>
        <div>
          <label class="form-label small fw-semibold">Links</label>
          <ProfileLinksInput
            fieldName="group.links"
            value={draft.links}
            onChange={(links) => setField("links", links)}
            helpText="Add any relevant group resources, such as a website, repository, document library, or meeting page."
            inputAriaLabel="Group resource URL"
          />
        </div>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label small fw-semibold" for="managed-group-visibility">
              Visibility
            </label>
            <select
              id="managed-group-visibility"
              class="form-select"
              value={draft.visibility}
              disabled={saving}
              onChange={(event) =>
                setField("visibility", (event.target as HTMLSelectElement).value as GroupSettingsDetail["visibility"])
              }
            >
              {GROUP_VISIBILITIES.map((value) => (
                <option key={value} value={value}>
                  {optionLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-semibold" for="managed-group-governance">
              Leadership inheritance
            </label>
            <select
              id="managed-group-governance"
              class="form-select"
              value={draft.governanceInheritanceMode}
              disabled={saving}
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
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-semibold" for="managed-group-eligibility">
              Join eligibility
            </label>
            <select
              id="managed-group-eligibility"
              class="form-select"
              value={draft.eligibilityMode}
              disabled={saving}
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
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-semibold" for="managed-group-enrollment">
              Automatic enrollment
            </label>
            <select
              id="managed-group-enrollment"
              class="form-select"
              value={draft.automaticEnrollmentMode}
              disabled={saving}
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
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label small fw-semibold" for="managed-group-endorser-count">
              Minimum endorsers for a ballot
            </label>
            <input
              id="managed-group-endorser-count"
              class="form-control"
              type="number"
              min={0}
              max={1000}
              value={draft.minEndorsersForBallot}
              disabled={saving}
              onInput={(event) => setField("minEndorsersForBallot", (event.target as HTMLInputElement).valueAsNumber)}
            />
          </div>
        </div>
        <div class="d-flex flex-column gap-2">
          <label class="form-check">
            <input
              class="form-check-input"
              type="checkbox"
              checked={draft.allowAutomaticOptOut}
              disabled={saving || draft.automaticEnrollmentMode === "none"}
              onChange={(event) => setField("allowAutomaticOptOut", (event.target as HTMLInputElement).checked)}
            />
            <span class="form-check-label">Allow people to opt out of automatic enrollment</span>
          </label>
          <label class="form-check">
            <input
              class="form-check-input"
              type="checkbox"
              checked={draft.publicLeadership}
              disabled={saving}
              onChange={(event) => setField("publicLeadership", (event.target as HTMLInputElement).checked)}
            />
            <span class="form-check-label">Publish leadership</span>
          </label>
          <label class="form-check">
            <input
              class="form-check-input"
              type="checkbox"
              checked={draft.active}
              disabled={saving}
              onChange={(event) => setField("active", (event.target as HTMLInputElement).checked)}
            />
            <span class="form-check-label">Active</span>
          </label>
        </div>
        {error && <ErrorAlert error={error} />}
        {saved && <div class="alert alert-success mb-0">Group settings updated.</div>}
        <div>
          <button type="submit" class="btn btn-success" disabled={saving || !draft.name.trim()}>
            {saving ? "Saving…" : "Save group settings"}
          </button>
        </div>
      </div>
    </form>
  );
}
