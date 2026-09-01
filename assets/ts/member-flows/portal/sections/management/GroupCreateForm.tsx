import { useEffect, useState } from "preact/hooks";
import {
  GROUP_AUTOMATIC_ENROLLMENT_MODES,
  GROUP_ELIGIBILITY_MODES,
  GROUP_GOVERNANCE_INHERITANCE_MODES,
  GROUP_VISIBILITIES,
  groupCreateSchema,
  groupCreationCapabilitiesResponseSchema,
  groupResponseSchema,
  type Group,
  type GroupCreateInput,
  type GroupType,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Spinner } from "../../../../components/Spinner";
import { ApiClientError, getJson, postJson } from "../../../../shared/api-client";
import { useData } from "../../../../hooks/useData";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import { activeGroupTypeCatalog, managedGroupCatalog } from "./catalog";

interface GroupCreateDraft {
  typeKey: string | null;
  parentGroupId: string | null;
  name: string;
  slug: string;
  description: string;
  links: string[];
  visibility: Group["visibility"];
  governanceInheritanceMode: Group["governanceInheritanceMode"];
  eligibilityMode: Group["eligibilityMode"];
  automaticEnrollmentMode: Group["automaticEnrollmentMode"];
  allowAutomaticOptOut: boolean;
  publicLeadership: boolean;
  minEndorsersForBallot: number;
}

/** The four enum-backed policy choices, each rendered from its shared vocabulary. */
const POLICY_CHOICES = [
  ["visibility", "Visibility", GROUP_VISIBILITIES],
  ["governanceInheritanceMode", "Leadership inheritance", GROUP_GOVERNANCE_INHERITANCE_MODES],
  ["eligibilityMode", "Join eligibility", GROUP_ELIGIBILITY_MODES],
  ["automaticEnrollmentMode", "Automatic enrollment", GROUP_AUTOMATIC_ENROLLMENT_MODES],
] as const;

function optionLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function draftFromType(type: GroupType | null): GroupCreateDraft {
  return {
    typeKey: type?.key ?? null,
    parentGroupId: null,
    name: "",
    slug: "",
    description: "",
    links: [],
    visibility: type?.defaultVisibility ?? "participants",
    governanceInheritanceMode: type?.defaultGovernanceInheritanceMode ?? "inherited",
    eligibilityMode: type?.defaultEligibilityMode ?? "managed",
    automaticEnrollmentMode: type?.defaultAutomaticEnrollmentMode ?? "none",
    allowAutomaticOptOut: type?.defaultAllowAutomaticOptOut ?? false,
    publicLeadership: false,
    minEndorsersForBallot: 0,
  };
}

export function GroupCreateForm({ onCreated }: { onCreated: (group: Group) => void }) {
  const capability = useData(
    () => getJson("/api/v1/groups/creation-capabilities", groupCreationCapabilitiesResponseSchema),
    [],
  );
  const [draft, setDraft] = useState<GroupCreateDraft>(() => draftFromType(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeSelected, setTypeSelected] = useState<GroupType | null>(null);

  useEffect(() => {
    if (!typeSelected) return;
    setDraft((current) => ({
      ...draftFromType(typeSelected),
      name: current.name,
      slug: current.slug,
      description: current.description,
      links: current.links,
      parentGroupId: current.parentGroupId,
      publicLeadership: current.publicLeadership,
      minEndorsersForBallot: current.minEndorsersForBallot,
    }));
  }, [typeSelected]);

  function setField<Key extends keyof GroupCreateDraft>(key: Key, value: GroupCreateDraft[Key]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    // The submit button stays focusable while the create is in flight — a
    // disabled control throws a screen-reader user out of the form they are
    // in the middle of — so the form itself refuses a second submission.
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const input = groupCreateSchema.parse({
        typeKey: draft.typeKey,
        parentGroupId: draft.parentGroupId,
        name: draft.name,
        slug: draft.slug.trim() || undefined,
        description: draft.description.trim() || null,
        links: draft.links,
        visibility: draft.visibility,
        governanceInheritanceMode: draft.governanceInheritanceMode,
        eligibilityMode: draft.eligibilityMode,
        automaticEnrollmentMode: draft.automaticEnrollmentMode,
        allowAutomaticOptOut: draft.allowAutomaticOptOut,
        publicLeadership: draft.publicLeadership,
        minEndorsersForBallot: draft.minEndorsersForBallot,
      }) satisfies GroupCreateInput;
      const response = await postJson("/api/v1/groups", input, groupResponseSchema);
      onCreated(response.group);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not create this group.");
    } finally {
      setSaving(false);
    }
  }

  if (capability.loading) return <Spinner label="Checking whether you can create a group…" />;
  if (capability.error) return <ErrorAlert error={capability.error} />;
  if (!capability.data?.canCreate) return null;

  const automaticEnrollmentOff = draft.automaticEnrollmentMode === "none";

  return (
    <div class="pk">
      <Panel aria-label="Create a group">
        <PanelHeader title="Create a group" headingLevel={2} />
        <PanelBody class="pk-stack">
          <p class="pk-small">Create a reusable group context for meetings, events, forms, votes, and membership.</p>
          <form class="pk-stack" onSubmit={(event) => void submit(event)}>
            {/* One disabled fieldset takes every control out of play while the
                create is in flight, rather than each deciding for itself. The
                submit control stays outside it so the button the reader just
                pressed keeps focus instead of being disabled from under them. */}
            <fieldset class="pk-fieldset pk-stack" disabled={saving}>
              <ServerSearchSelect
                catalog={activeGroupTypeCatalog}
                label="Group type"
                value={draft.typeKey}
                selectedLabel={typeSelected?.pluralLabel}
                allowEmpty={false}
                onChange={(type) => {
                  setTypeSelected(type);
                  setField("typeKey", type?.key ?? null);
                }}
              />
              <ServerSearchSelect
                catalog={managedGroupCatalog}
                label="Parent group (optional)"
                value={draft.parentGroupId}
                selectedLabel={undefined}
                placeholder="Top-level group"
                onChange={(group) => setField("parentGroupId", group?.id ?? null)}
              />
              <div class="pk-grid pk-grid--roomy">
                <Field label="Name" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={draft.name}
                      onInput={(event) => setField("name", event.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field label="Slug (optional)" help="Leave blank to derive one from the name.">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={draft.slug}
                      onInput={(event) => setField("slug", event.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Description">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    value={draft.description}
                    onInput={(event) => setField("description", event.currentTarget.value)}
                  />
                )}
              </Field>
              {/* The link editor is several controls, not one, so the group is
                  named by a legend rather than by a label with nothing to point
                  at — and `pk-field` is the group that legend belongs to. */}
              <fieldset class="pk-fieldset pk-field">
                <legend class="pk-field__label">Links</legend>
                <ProfileLinksInput
                  fieldName="group-create.links"
                  value={draft.links}
                  onChange={(links) => setField("links", links)}
                  helpText="Add relevant group resources."
                  inputAriaLabel="Group resource URL"
                />
              </fieldset>
              <div class="pk-grid pk-grid--roomy">
                {POLICY_CHOICES.map(([key, label, options]) => (
                  <Field label={label} key={key}>
                    {(control) => (
                      <Select
                        {...control}
                        value={draft[key]}
                        onChange={(event) => setField(key, event.currentTarget.value as never)}
                      >
                        {options.map((value) => (
                          <option key={value} value={value}>
                            {optionLabel(value)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ))}
                <Field label="Minimum endorsers for a ballot">
                  {(control) => (
                    <TextInput
                      {...control}
                      type="number"
                      min={0}
                      max={1000}
                      value={draft.minEndorsersForBallot}
                      onInput={(event) => setField("minEndorsersForBallot", event.currentTarget.valueAsNumber)}
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
                    disabled={automaticEnrollmentOff}
                    onChange={(event) => setField("allowAutomaticOptOut", event.currentTarget.checked)}
                  />
                  {/* The control is unavailable because of another answer, not
                      because it is off, so the reason is written out rather
                      than left to the greyed-out styling. */}
                  <span class="pk-check__label">
                    Allow people to opt out of automatic enrollment
                    {automaticEnrollmentOff && " — available once automatic enrollment is set"}
                  </span>
                </label>
                <label class="pk-check">
                  <input
                    class="pk-check__input"
                    type="checkbox"
                    checked={draft.publicLeadership}
                    onChange={(event) => setField("publicLeadership", event.currentTarget.checked)}
                  />
                  <span class="pk-check__label">Publish leadership</span>
                </label>
              </div>
            </fieldset>
            {error && <ErrorAlert error={error} />}
            <div class="pk-cluster">
              <Button type="submit" variant="primary" loading={saving} disabled={!draft.typeKey || !draft.name.trim()}>
                {saving ? "Creating…" : "Create group"}
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
