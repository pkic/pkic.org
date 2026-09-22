import { useEffect, useState } from "preact/hooks";
import { groupResponseSchema, groupUpdateSchema, type GroupSettingsDetail } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { EditActions } from "../../../../ui/EditActions";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { GroupSettingsFields } from "./GroupSettingsFields";
import { draftFromGroup, optionLabel } from "./group-settings-draft";

export function GroupSettingsForm({
  group,
  onUpdated,
}: {
  group: GroupSettingsDetail;
  onUpdated: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftFromGroup(group));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const body = {
    ...draft,
    abbreviatedName: draft.abbreviatedName.trim() || null,
    expectedRevision: group.revision,
    description: draft.description.trim() || null,
  };
  const form = useContractForm(groupUpdateSchema, body);
  useEffect(() => {
    setDraft(draftFromGroup(group));
    setEditing(false);
    setError(null);
  }, [group.id, group.revision]);
  function reset() {
    setDraft(draftFromGroup(group));
    form.reset();
    setError(null);
    setSaved(false);
  }
  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (saving || !editing) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await patchJson(`/api/v1/groups/${encodeURIComponent(group.id)}`, checked.data, groupResponseSchema);
      await onUpdated();
      setEditing(false);
      setSaved(true);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form noValidate class="pk" {...form.handlers} onSubmit={submit}>
      <Panel>
        <PanelHeader title="Group settings">
          <EditActions
            label="Group settings actions"
            editing={editing}
            saving={saving}
            saveLabel="Save group settings"
            onEdit={() => {
              reset();
              setEditing(true);
            }}
            onCancel={() => {
              reset();
              setEditing(false);
            }}
          />
        </PanelHeader>
        <PanelBody class="pk-stack">
          {editing ? (
            <GroupSettingsFields draft={draft} saving={saving} setDraft={setDraft} fields={form.of} />
          ) : (
            <DescriptionList
              items={[
                { term: "Name", value: group.name },
                { term: "Abbreviated name", value: group.abbreviatedName },
                { term: "Description", value: group.description },
                {
                  term: "Links",
                  value: group.links.length
                    ? group.links.map((url) => (
                        <a key={url} href={url} class="pk-break">
                          {url}
                        </a>
                      ))
                    : null,
                },
                { term: "Visibility", value: optionLabel(group.visibility) },
                { term: "Leadership inheritance", value: optionLabel(group.governanceInheritanceMode) },
                { term: "Join eligibility", value: optionLabel(group.eligibilityMode) },
                { term: "Automatic enrollment", value: optionLabel(group.automaticEnrollmentMode) },
                { term: "Minimum endorsers for a ballot", value: group.minEndorsersForBallot },
                { term: "Automatic enrollment opt-out", value: group.allowAutomaticOptOut ? "Allowed" : "Not allowed" },
                { term: "Public leadership", value: group.publicLeadership ? "Published" : "Private" },
                { term: "Public roster", value: group.publicRoster ? "Published" : "Private" },
                { term: "Status", value: group.active ? "Active" : "Inactive" },
              ]}
            />
          )}
          {error && <ErrorAlert error={error} />}
          {saved && <Alert tone="ok">Group settings updated.</Alert>}
        </PanelBody>
      </Panel>
    </form>
  );
}
